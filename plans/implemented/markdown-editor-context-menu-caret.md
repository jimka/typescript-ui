---
depends-on: [markdown-columns-fixes]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-document-panel.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/MarkdownDocumentPanel.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Context Menu Caret and Availability — Implementation Plan

## Overview

This plan fixes two bugs in the WYSIWYG context menu of `MarkdownEditor`. Both are on `master` too. Line numbers below are for the tip of the Markdown stack (`feature/markdown-columns-fixes`, `120c1d65d`).

1. **A keyboard-opened menu ignores the caret.** Shift+F10 or the ContextMenu key fires a native `contextmenu` event whose target is the editor's contenteditable root, not the content at the caret. [`handleWysiwygContextMenu`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3788) resolves that target with `$getNearestNodeFromDOMNode`, which returns the Lexical `RootNode`. [`$classifyContextMenuTarget`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1771) then treats the root as prose (`kind: "text"`). The result: with the caret in a table cell, the keyboard menu has no Table submenu.
2. **The menu offers commands the editor will decline.** In a raw Markdown block (`MarkdownRawBlockNode`) or a code block, the Bold/Italic/… rows, Text style and Insert link… are all enabled, but the commands decline silently. The same thing happens over a run kept as Markdown source, inside a link (Text style), in a link nested in a link (link commands), and with a selection that reaches into a table (Block style). The [`MarkdownDocumentPanel`](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L491) toolbar has the same gap: it never disables the format buttons or Text style.

The fix lives entirely in `MarkdownEditor.ts`, plus a small change to the toolbar in `MarkdownDocumentPanel.ts`. `MarkdownEditorSelectionState` gets one new public field, `canFormat`. A read-only editor's menu is also cut down to Copy, as `TextInput`'s and `CodeEditor`'s menus already are.

---

## Architecture Decisions

### Keep the one native `contextmenu` entry; resolve a root target from the selection

The editor keeps handling only the native `contextmenu` event, through the existing `WysiwygSurface` subtree listener ([MarkdownEditor.ts:1926](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1926)). Browsers fire this event for Shift+F10 and the ContextMenu key as well as for a right-click. No new keydown handling is added.[^single-entry]

A new exported helper, `$contextMenuNodeFor(target)`, picks the node the menu is built for:

| Event target resolves to | Node used | Typical gesture |
|---|---|---|
| A node inside the document (text, cell, image, …) | that node, unchanged | right-click on content |
| The `RootNode`, with a range selection or table selection | the selection's anchor node | Shift+F10 / ContextMenu key; right-click in the root's padding |
| The `RootNode`, with no range or table selection | the `RootNode` (today's behaviour) | keyboard menu with no selection |

This follows [`CodeEditor.handleContextMenu`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2842). It also handles the single native event and reads its state from the editor's selection rather than from the event target. Mouse classification stays target-based, so a right-click is unchanged.[^why-root-test]

### Position comes from the event's coordinates

The menu still opens at `event.clientX` / `event.clientY`. For a keyboard-invoked `contextmenu` in editable content, the browser already puts those coordinates at the caret or at the start of the selection. Chromium was checked (see the footnote), and Gecko and WebKit compute them the same way. No caret-rectangle read is added.[^position]

### One rule for command availability, read by the menu and by the selection state

A new module-private function, `$readCommandAvailability(expansion)`, returns a `CommandAvailability` record. It is built only from the predicates the commands already use to decline, so the menu cannot drift from the commands:

| Field | `false` when | Commands it covers |
|---|---|---|
| `canFormat` | `$selectionTouchesTextOnlyBlock()` (raw or code block), or a run kept as source is covered — evaluated on the would-be word expansion for a collapsed caret | `toggleBold` / `toggleItalic` / `toggleUnderline` / `toggleStrikethrough` / `toggleInlineCode` |
| `canStyle` | `canFormat` is false, or the anchor is inside a link | `setTextColor` / `setFontFamily` / `setFontSize` |
| `canLink` | `canFormat` is false, or `$selectionInNestedLinkRun()` | `toggleLink(url)` (Insert link… / Edit link…) |
| `canRemoveLink` | `$selectionInNestedLinkRun()` | `removeLink` |
| `canSetBlockType` | `$selectionTouchesTableCell()` | `setBlockType`, `toggleUnorderedList`, `toggleOrderedList` |
| `canInsertObject` | `$selectionTouchesTextOnlyBlock()` | `insertTable`, `insertImage` |

`$classifyContextMenuTarget` attaches the whole record to every `ContextMenuTarget` as `availability`. `$readSelectionState` exposes only `canFormat` publicly. The toolbar derives the rest from fields it already has (`linkUrl`).[^availability-source]

A collapsed caret is judged on what the toggle would act on: the toggle first expands the caret to its word or run, then dispatches `FORMAT_TEXT_COMMAND`, whose `$declinesFormat` check runs on the expanded selection. So the source-run part of `canFormat` uses `$computeWordExpansion()` when it returns a value.[^expansion]

Availability always comes from the **live selection**, never from the clicked node. The commands act on the selection, so that is what decides whether they will decline.[^selection-not-target]

### Disable, don't hide

A declined command keeps its row and is dimmed (`enabled: false`). This matches the existing "Insert link…" row, which is dimmed when there is nothing to wrap. A submenu whose entries all share one rule (Block style, Text style, the empty-line Heading submenu) is disabled at its parent row; `MenuItem` does not open the submenu of a disabled row ([MenuItem.ts:318](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L318)). The empty-line Insert submenu mixes two rules, so its entries are disabled one by one.

### A read-only editor's menu offers Copy only

When `getReadOnly()` is true, `buildContextMenuItems` returns `buildClipboardMenuItems({ hasSelectedText, copy })` and nothing else. This mirrors [`CodeEditor.buildContextMenuItems`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2831) and [`TextInput.handleContextMenu`](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L203), which both omit Cut and Paste when read-only.[^read-only]

### The toolbar reads the same rule

`MarkdownDocumentPanel.applySelectionState` disables the five format toggles when `!state.canFormat`, disables Text style when `!state.canFormat || state.linkUrl !== null`, and changes the Link button's rule to `(state.hasSelectedText && state.canFormat) || state.linkUrl !== null`.[^toolbar-scope]

In `"source"` mode `canFormat` is always `true`. Source-mode declines depend on the exact raw text and are not predicted.[^source-mode]

---

## Public API

```typescript
export interface MarkdownEditorSelectionState {
    // …existing fields unchanged…
    /**
     * Whether the inline-format toggles would apply at the selection. `false`
     * where they decline: the selection touches a raw Markdown block or a
     * code block, or holds (or a collapsed caret would expand into) a run
     * kept as Markdown source. Text colour, font and size also decline
     * inside a link (`linkUrl !== null`). Always `true` in `"source"` mode.
     */
    canFormat: boolean;
}
```

Module exports that are not in the barrel (exported for tests, like `ContextMenuTarget` and `$classifyContextMenuTarget` already are):

```typescript
export interface CommandAvailability {
    canFormat: boolean;
    canStyle: boolean;
    canLink: boolean;
    canRemoveLink: boolean;
    canSetBlockType: boolean;
    canInsertObject: boolean;
}

// Each of the three ContextMenuTarget variants gains:
//     availability?: CommandAvailability;
// Optional so hand-built test contexts keep compiling; a missing value means
// every command is available (ALL_COMMANDS_AVAILABLE).

export function $contextMenuNodeFor(target: LexicalNode): LexicalNode;
```

`CommandAvailability` must be exported, because the exported `ContextMenuTarget` uses it and the library build emits declarations.

---

## Internal Structure

The new helpers sit next to `$selectionCoversSourceRun` / `$readFormatFlags`:

```typescript
/** Every command available — the default for a ContextMenuTarget built without `availability`. */
const ALL_COMMANDS_AVAILABLE: CommandAvailability = {
    canFormat: true, canStyle: true, canLink: true,
    canRemoveLink: true, canSetBlockType: true, canInsertObject: true,
};

/** Extracted from $selectionCoversSourceRun's `some` callback: the per-node half of its test. */
function $isFormatBlockingSourceRun(node: LexicalNode): boolean {
    return $isMarkdownSourceTextNode(node)
        && !(node.getSource().trim() === "" && $getState(node, keptSourceState) === null);
}

function $readCommandAvailability(expansion: WordExpansion | null): CommandAvailability {
    const selection = $getSelection();
    const inTextOnlyBlock = $selectionTouchesTextOnlyBlock();
    const coversSourceRun = expansion !== null ? $isFormatBlockingSourceRun(expansion.node) : $selectionCoversSourceRun();
    const inNestedLinkRun = $selectionInNestedLinkRun();
    const inLink = $isRangeSelection(selection) && $findEnclosingLinkNode(selection.anchor.getNode()) !== null;
    const canFormat = !inTextOnlyBlock && !coversSourceRun;

    return {
        canFormat,
        canStyle:        canFormat && !inLink,
        canLink:         canFormat && !inNestedLinkRun,
        canRemoveLink:   !inNestedLinkRun,
        canSetBlockType: !$selectionTouchesTableCell(),
        canInsertObject: !inTextOnlyBlock,
    };
}

export function $contextMenuNodeFor(target: LexicalNode): LexicalNode {
    if (!$isRootNode(target)) {
        return target;
    }

    const selection = $getSelection();

    if ($isRangeSelection(selection) || $isTableSelection(selection)) {
        return selection.anchor.getNode();
    }

    return target;
}
```

`$selectionCoversSourceRun`'s callback becomes `if (!$isFormatBlockingSourceRun(node)) { return false; }`, followed by the unchanged offset test. Keep its inline comment about soft breaks above the new helper.

`handleWysiwygContextMenu` changes in one line, inside its `editor.read`:

```typescript
context = $classifyContextMenuTarget($contextMenuNodeFor(node));
```

---

## Ordered Implementation Steps

Write the tests for each step first (see `## Expected Behaviour`), then the code.

1. **`MarkdownEditor.ts` — extract the source-run predicate.** Add `$isFormatBlockingSourceRun` directly above [`$selectionCoversSourceRun`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1451) and make the callback use it. Check: `npm test -- markdown-editor` stays green (no behaviour change).
2. **`MarkdownEditor.ts` — availability type and reader.** Below [`$readFormatFlags`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1740), add the exported `CommandAvailability` interface (JSDoc each field with the "Commands it covers" column), `ALL_COMMANDS_AVAILABLE`, and `$readCommandAvailability`. Every function is defined above `$readCommandAvailability`, so the order is fine.
3. **`MarkdownEditor.ts` — `ContextMenuTarget`.** Add `availability?: CommandAvailability;` to all three variants of [`ContextMenuTarget`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1590). Extend the type's JSDoc with one sentence: a missing `availability` means every command is available.
4. **`MarkdownEditor.ts` — classification.** In `$classifyContextMenuTarget`, compute `const availability = $readCommandAvailability(expansion);` next to `formatState` and add `availability` to each of the three returned objects (`empty-line` included). Update the JSDoc: the availability is read from the live selection, not from `node`.
5. **`MarkdownEditor.ts` — public selection state.** Add `canFormat` (Public API JSDoc) to [`MarkdownEditorSelectionState`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L124), placed after `linkUrl`. Then:
   - [`$readSelectionState`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1811): `canFormat: $readCommandAvailability(expansion).canFormat`.
   - [`NEUTRAL_SELECTION_STATE`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1834): `canFormat: true`.
   - [`selectionStatesEqual`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1849): add `&& a.canFormat === b.canFormat`.
   - [`readActiveSelectionState`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2404) source branch: add `canFormat: true` beside `inTable: false`.
   Check: `npm run typecheck` passes.
6. **`MarkdownEditor.ts` — caret resolution.** Add the exported `$contextMenuNodeFor` (JSDoc: the target is used unless it is the root, which is what a keyboard-opened menu targets; then the selection's anchor). Place it directly above `$classifyContextMenuTarget`. Use it in [`handleWysiwygContextMenu`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3788) as shown in `## Internal Structure`. Add one sentence to that method's JSDoc about the keyboard case. `$isRootNode` and `$isTableSelection` are already imported.
7. **`MarkdownEditor.ts` — read-only menu.** At the top of [`buildContextMenuItems`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3929): `if (this.getReadOnly()) { return buildClipboardMenuItems({ hasSelectedText: context.hasSelectedText, copy: () => this.copy() }); }`. `buildClipboardMenuItems` is already imported (line 14).
8. **`MarkdownEditor.ts` — menu builders read availability.** In each of the three kind builders, start with `const availability = context.availability ?? ALL_COMMANDS_AVAILABLE;` and pass it down:
   - [`buildFormatToggleItems`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3948) takes `(format, enabled: boolean)`. The `toggleRow` helper constructs `new CheckboxMenuRow({ text, checked, enabled })`. Callers pass `availability.canFormat`.
   - [`buildTextStyleMenuItem`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3978) takes `(enabled: boolean)` and sets `enabled` on the returned parent item. Callers pass `availability.canStyle`.
   - [`buildLinkMenuItems`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4075) takes `(context, availability)`. Insert link…: `enabled: context.hasSelectedText && availability.canLink`. Edit link…: `enabled: availability.canLink`. Remove link: `enabled: availability.canRemoveLink`.
   - [`buildTextContextMenuItems`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4101): the "Block style" parent gets `enabled: availability.canSetBlockType`.
   - [`buildEmptyLineContextMenuItems`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4166): the "Heading" parent gets `enabled: availability.canSetBlockType`. In the Insert submenu, Quote / Code block / Bulleted list / Numbered list get `enabled: availability.canSetBlockType`, and Table / Image… get `enabled: availability.canInsertObject`.
   - [`buildTableCellContextMenuItems`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4201): format rows, Text style and link items as above. The Table submenu is unchanged.
   Update each changed builder's JSDoc `@param`. Check: `grep -n 'buildFormatToggleItems(\|buildTextStyleMenuItem(\|buildLinkMenuItems(' MarkdownEditor.ts` — every call passes the new argument.
9. **`MarkdownDocumentPanel.ts` — toolbar.** Promote the local `textStyleBtn` ([:265](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L265)) to a field `private _textStyleBtn!: MenuButton<MenuButtonOptions>;`, declared beside `_tableBtn` ([:179](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L179)), and update its `addComponents` reference. In [`applySelectionState`](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L491) add `setEnabled(state.canFormat)` for the five format buttons and `this._textStyleBtn.setEnabled(state.canFormat && state.linkUrl === null)`, and change the Link line to `this._linkBtn.setEnabled((state.hasSelectedText && state.canFormat) || state.linkUrl !== null)`. Rewrite the method's JSDoc to match.
10. **Tests — bring existing expectations up to date.** In `packages/lib/tests/component/markdown-editor.test.ts`:
    - Add `canFormat: true` to every `MarkdownEditorSelectionState` literal (`grep -n 'columnCount: 1' tests/component/markdown-editor.test.ts` finds them: the `NEUTRAL` const at ~2840 and the source-mode literals at ~1222 / ~1241).
    - Add `availability: ALL_AVAILABLE` (a test-local copy of the all-`true` record) to every exact `toEqual` of a `$classifyContextMenuTarget` result (~2579, 2599, 2717, 2734, 2751, 2773, 4052; `grep -n "expect(result).toEqual" …` to find them).
    - Replace the test "Edit link… and Remove link are always enabled…" (~3512) so it asserts `enabled: true` when `availability` is all-`true`, and that a missing `availability` behaves the same.
    - Step 8 now writes `enabled: true` on items that had no `enabled` key (Edit link…, Remove link, Block style, Text style, Heading, the Insert entries). Any existing assertion that one of these is `undefined` changes to `true`.
11. **Tests — new cases.** Add the `## Expected Behaviour` unit cases. Put R/A/M in a new `describe('MarkdownEditor context menu — caret and availability')` in `markdown-editor.test.ts`, and T in `markdown-document-panel.test.ts`. Extend `contextMenuMethodsOf`'s type only if a new private method is reached (none is required).
12. **Docs and changelog** — see `## Documentation Impact`.
13. **Full check** — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-document-panel.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownDocumentPanel.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

"Unit" cases run offline against the headless Lexical editor (`lexicalOf(editor).read(…)` / `.update(…)`, as the existing `$classifyContextMenuTarget` tests do). "Manual" cases need a real browser.

### R — which node the menu is built for

Each R case calls `$classifyContextMenuTarget($contextMenuNodeFor(target))` inside `read`. `target` is `$getRoot()` (a keyboard-opened menu) unless stated otherwise.

| # | Document and selection | Expected | Test |
|---|---|---|---|
| R1 | `\| a \| b \|\n\| - \| - \|\n\| c \| d \|`, caret collapsed in cell `c` | `kind: "table-cell"`; `buildContextMenuItems` contains a "Table" item | unit |
| R2 | `hello world`, caret inside `world` | `kind: "text"`, `hasSelectedText: true` | unit |
| R3 | fresh editor (`ensureEditor()` leaves one empty paragraph), `$getRoot().selectStart()` | `kind: "empty-line"` | unit |
| R4 | `[x]: https://one` (loads as a raw block), caret inside it | `kind: "text"`, `availability.canFormat: false` | unit |
| R5 | ```` ```\ncode\n``` ````, caret inside `code` | `kind: "text"`, `hasEnclosingBlock: true`, `availability.canFormat: false` | unit |
| R6 | `A [text](https://x) link.`, caret inside `text` | `kind: "text"`, `linkUrl: "https://x"`, `availability.canStyle: false` | unit |
| R7 | `![](https://x/a.png)` alone in a paragraph, `paragraph.select(1, 1)` (an element point after the image) | the same `kind` as classifying the image node itself (a right-click on the image), expected `"empty-line"` — this classification is not changed | unit |
| R8 | `hello\n\n` + R1's table, caret in `hello`; `target` = the text node in cell `c` (a mouse right-click) | `kind: "table-cell"` — a non-root target is used as given | unit |
| R9 | R1's document, `$setSelection(null)`, `target` = root | the root is returned; `kind: "text"` (today's behaviour) | unit |

### A — availability (read from the live selection)

| # | Selection | `availability` (only the fields that change from all-`true`) | `getSelectionState().canFormat` | Test |
|---|---|---|---|---|
| A1 | caret inside a plain word | all `true` | `true` | unit |
| A2 | caret in a raw block (R4) | `canFormat`, `canStyle`, `canLink`, `canInsertObject`: `false` | `false` | unit |
| A3 | caret in a code block (R5) | same as A2 | `false` | unit |
| A4 | `a <span>x</span> b`, collapsed caret inside the letters of the `<span>` run (assert first that the anchor is a `MarkdownSourceTextNode`) | `canFormat`, `canStyle`, `canLink`: `false` (via the expansion) | `false` | unit |
| A5 | A4's document, `$selectAll()` | same as A4 (via `$selectionCoversSourceRun`) | `false` | unit |
| A6 | caret inside the link text (R6) | `canStyle: false` | `true` | unit |
| A7 | `[a [b](https://y) c](https://x)`, caret inside `b` (assert `$selectionInNestedLinkRun` applies, i.e. `removeLink()` leaves the document unchanged) | `canLink`, `canRemoveLink`: `false` | `true` | unit |
| A8 | `para\n\n\| a \|\n\| - \|\n\| c \|`, range from `para` into cell `c` | `canSetBlockType: false` | `true` | unit |
| A9 | Consistency: for A2–A5, calling the matching command (`toggleBold`, `setTextColor("#f00")`, `toggleLink("https://z")`) leaves `getValue()` unchanged; for A1 it changes it | — | — | unit |

### M — menu built from a context

All M cases call `buildContextMenuItems` directly.

| # | Context | Expected | Test |
|---|---|---|---|
| M1 | `kind: "text"`, `availability.canFormat/canStyle/canLink: false` | the five format rows build `CheckboxMenuRow`s with `isEnabled() === false`; "Text style" `enabled: false`; "Insert link…" `enabled: false` even with `hasSelectedText: true` | unit |
| M2 | any kind, `availability` omitted | identical to `availability: ALL_AVAILABLE` (every existing menu test keeps passing) | unit |
| M3 | `kind: "text"`, `linkUrl` set, `canLink: false`, `canRemoveLink: false` | "Edit link…" and "Remove link" `enabled: false` | unit |
| M4 | `kind: "text"`, `canSetBlockType: false` | "Block style" `enabled: false`; Alignment and Columns are unaffected | unit |
| M5 | `kind: "empty-line"`, `canSetBlockType: false`, `canInsertObject: false` | "Heading" `enabled: false`; Insert ▸ Quote, Code block, Bulleted list, Numbered list, Table, Image… all `enabled: false` | unit |
| M6 | `kind: "table-cell"`, `canFormat: false` | format rows disabled; the "Table" submenu still present and enabled | unit |
| M7 | `new MarkdownEditor("", { readOnly: true })`, each of the three kinds, `hasSelectedText` `true` then `false` | exactly `[{ text: "Copy", enabled: hasSelectedText }]` | unit |

### T — toolbar (`MarkdownDocumentPanel`)

| # | State | Expected | Test |
|---|---|---|---|
| T1 | after construction | five format buttons and Text style enabled (neutral `canFormat: true`) | unit |
| T2 | `setValue('[x]: https://one\n\ntext')`, caret in the raw block | five format buttons, Text style and Link disabled | unit |
| T3 | T2, then caret moved into `text` | all re-enabled | unit |
| T4 | caret inside a link (existing test's document) | Text style disabled; Link enabled | unit |
| T5 | T2's document after the source toggle, i.e. `getEditor().setMode("source")` | five format buttons enabled | unit |

### X — manual (real browser)

Run these in Chromium and Firefox, on the dev demo's Markdown editor page (`npm run dev`, `#/md-editor`).

| # | Gesture | Expected |
|---|---|---|
| X1 | caret in a table cell, Shift+F10 | menu with the Table submenu, top-left corner at the caret |
| X2 | same, ContextMenu key | same as X1 |
| X3 | select a word range in a paragraph, Shift+F10 | text menu at the start of the selection |
| X4 | right-click inside a cell with the caret elsewhere | table-cell menu at the pointer (unchanged) |
| X5 | right-click in the empty area below the last block | menu for wherever the caret is, at the pointer |
| X6 | caret in a raw block (e.g. a link reference definition), Shift+F10 | format rows, Text style, Insert link… dimmed; toolbar format buttons and Text style dimmed |
| X7 | `setReadOnly(true)` (from the console), right-click on text | only Copy |

---

## Verification

- `npm run typecheck` and `npm test` (runs `typecheck:test` and vitest) pass.
- `npm run lint` passes.
- `npm run docs:api` finishes with zero warnings. `canFormat`'s JSDoc names no internal symbol.
- `grep -n 'availability' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` shows it read in all three kind builders.
- The manual X cases above.

---

## Documentation Impact

`MarkdownEditorSelectionState` is re-exported from `component/editor/index.ts` (line 14), so `canFormat` appears in the API docs automatically. `ContextMenuTarget`, `CommandAvailability` and `$contextMenuNodeFor` are not in the barrel.

- **`docs/components/MarkdownEditor.md`**
  - In the context-menu paragraph ([:108](../packages/lib/docs/components/MarkdownEditor.md#L108)), after "No consumer wiring needed — right-clicking the surface shows it directly.", add: "Shift+F10 or the ContextMenu key opens the same menu for wherever the caret or selection is, positioned there. An item whose command would decline at the selection is dimmed: the format toggles, Text style and Insert/Edit link in a raw Markdown block, a code block or over text kept as Markdown source; Text style inside a link; Block style, Heading and the list and block conversions when the selection reaches into a table cell. In a read-only editor the menu offers only Copy."
  - In *Live selection state* ([:144](../packages/lib/docs/components/MarkdownEditor.md#L144)), add `canFormat` to the list of reported fields, and after the paragraph ending "`columnCount` is `1`." add: "`canFormat` is `false` where the format toggles decline — a raw Markdown block, a code block, or text kept as Markdown source — so a toolbar can grey its format buttons out; text colour, font and size also decline inside a link (`linkUrl !== null`). In `"source"` mode `canFormat` is always `true`."
- **`docs/components/MarkdownDocumentPanel.md`**
  - [:33](../packages/lib/docs/components/MarkdownDocumentPanel.md#L33): drop Text style from "The Insert, Text style, Alignment, and Columns dropdowns stay always-enabled".
  - [:35](../packages/lib/docs/components/MarkdownDocumentPanel.md#L35): add that the five format buttons and the Text style dropdown are disabled where `canFormat` is `false` (Text style also inside a link), and that the Link button needs a selection the format commands accept, or an enclosing link.
- **`docs/reference/changelog/next.md`**
  - Under `## Added › ### Components`: "**`MarkdownEditorSelectionState.canFormat`** reports whether the format toggles would apply at the selection, for greying out a toolbar's format buttons."
  - Under `## Fixed › ### Components`: "**`MarkdownEditor`'s keyboard-opened context menu follows the caret.** Shift+F10 and the ContextMenu key built the plain text menu from the editor root, so a caret in a table cell got no Table submenu; the menu is now built for the caret's position and opens there. The menu and `MarkdownDocumentPanel`'s toolbar also dim commands the editor would decline at the selection (formatting in a raw or code block, Text style inside a link, block conversions reaching into a table), and a read-only editor's menu offers only Copy."

---

## Potential Challenges

- **Exact-shape tests break in bulk.** Adding `availability` and `canFormat` changes every exact `toEqual` on those objects. Step 10 lists how to find them all; fix them before writing new tests so failures stay meaningful.
- **A4/A7 depend on the importer.** If `<span>` or a nested link does not load as a kept-source run on this stack, pick another construct from `$selectionCoversSourceRun`'s JSDoc (a task-list marker, `- [ ] task`) and keep the assertion that the node is a `MarkdownSourceTextNode`.
- **`CheckboxMenuRow` enabled state.** Read it with `row.isEnabled()` (it delegates to the inner `Checkbox`), not from the config.
- **Firefox target.** If Firefox targets the element at the caret instead of the root, the target path gives the same node; X1 in Firefox confirms either way.

---

## Critical Files

- [`MarkdownEditor.ts`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `$selectionTouchesTextOnlyBlock` (:1405), `$selectionTouchesTableCell` (:1425), `$selectionCoversSourceRun` (:1451), `$selectionInNestedLinkRun` (:1483), `$declinesFormat` (:1506), `ContextMenuTarget` (:1590), `$computeWordExpansion` (:1642), `$classifyContextMenuTarget` (:1771), `$readSelectionState` (:1811), the command methods `toggleBold` … `insertImage` (:2538–3360), `handleWysiwygContextMenu` (:3788), the menu builders (:3929–4240).
- [`CodeEditor.ts:2831–2846`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2831) — the precedent: one native `contextmenu` entry, state read from the selection, read-only menu without Cut/Paste.
- [`TextInput.ts:203`](../packages/lib/src/typescript/lib/component/input/TextInput.ts#L203) — read-only menu precedent.
- [`MarkdownDocumentPanel.ts:491`](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L491) — `applySelectionState`.
- [`MenuItem.ts:53`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L53) — `MenuItemConfig.enabled`, and :318 for disabled submenu parents.
- [`markdown-editor.test.ts`](../packages/lib/tests/component/markdown-editor.test.ts) — `$classifyContextMenuTarget` tests (:2566) and context-menu tests (:3417) for the harness style.

---

## Non-Goals

- **Arrow-key navigation inside the open menu.** `Menu.handleKey` exists, but no rebuild-mode context menu in the library (Table, TextInput, CodeEditor, this editor) forwards keydowns to it today; Escape already closes it. That is a cross-component change.
- **Predicting `$editWritably` refusals.** Some edits (Clear formatting, a toggle whose markers could not round-trip) are only refused after trying them. Those items stay enabled.
- **Source-mode availability.** `canFormat` is `true` in `"source"` mode, and the source-mode `CodeEditor` menu is untouched.
- **An image-only paragraph classifying as `"empty-line"`.** This is a quirk of the existing classification. It is kept so the keyboard and mouse menus agree (R7).
- **Refusing commands on a read-only editor.** The public command methods keep working programmatically; only the menu is restricted.
- **Line numbers on `master`.** This plan targets the stack tip.

---

## Notes

[^single-entry]: Every library component that shows a context menu (`Table`'s `Body.onCellContextMenu`, `Tree._handleContextMenu`, `TextInput`, `CodeEditor`, `Markdown`) handles only the native `contextmenu` event and reads `clientX` / `clientY`. None special-cases Shift+F10. A grep for `F10` and `"ContextMenu"` across `packages/lib/src` finds nothing. An editor-owned keydown handler was rejected for two reasons. It would need to stop the browser's own event, and on some platforms the ContextMenu key raises `contextmenu` on key-up rather than key-down, so cancelling the keydown would not reliably prevent a second menu. It would also be the only such handler in the library.

[^why-root-test]: A keyboard-opened menu is detected by its target resolving to the `RootNode`, not by inspecting the event. In Chromium the keyboard event is a `PointerEvent` with `button: -1` and `pointerType: "mouse"`. Those values differ by engine, and WebKitGTK (the Tauri target) is not covered by any spec guarantee. The root test is engine-independent: Chromium and WebKit dispatch a keyboard `contextmenu` to the focused element, which is the contenteditable root. Lexical keys that element as `"root"` (`setNodeKeyOnDOMNode(nextRootElement, editor, 'root')` in `lexical` 0.49), so `$getNearestNodeFromDOMNode` returns the `RootNode`. A right-click in the root's own padding also targets the root. There is no content under that pointer, so the caret is the only meaningful answer there too. A right-click on content keeps its target, because on Linux and macOS `contextmenu` fires on mousedown, before Lexical has processed any caret move the click causes.

[^position]: Measured in Chromium via DevTools on a bare contenteditable: a collapsed caret at x 60.5, line 84–103 gave `clientX: 60, clientY: 93`, with the target being the root element, for both Shift+F10 and the ContextMenu key. A range starting at x 28 on line 44–63 gave `(28, 53)`: the start of the selection, at the line's vertical middle. WebKit (`EventHandler::sendContextMenuEventForKey`) and Gecko (`PresShell::PrepareToUseCaretPosition`) also place a keyboard menu at the selection in editable content. Reading the caret rectangle ourselves would need a new `DOM.source` read (the seam has none for a range rectangle) only to reproduce what the browser already supplies. `Menu.show` clamps the point into the viewport.

[^availability-source]: Only `canFormat` is public because it is the one fact a consumer toolbar cannot derive. `canStyle` is `canFormat && linkUrl === null`, and the rest concern commands the panel toolbar reaches through menus it builds itself. Keeping the record private avoids freezing five more public fields for corner cases such as nested links.

[^expansion]: The format toggles call `$selectEnclosingWordIfCollapsed()` and then `FORMAT_TEXT_COMMAND`. The editor's high-priority handler (`$formatWritably(format, $declinesFormat)`, :3743) declines when `$selectionCoversSourceRun()` is true on the expanded selection. That expanded selection spans exactly `expansion.node` from `start` to `end`, a non-empty range in one node, so `$selectionCoversSourceRun`'s offset test reduces to the per-node predicate. A bare caret with no expansion stays collapsed, and `$selectionCoversSourceRun` returns `false` for a collapsed selection, which is what the fallback branch evaluates. The text-only-block test reads anchor and focus, which the expansion does not move out of their block, so it needs no expansion handling.

[^selection-not-target]: For a mouse right-click the clicked node and the caret can differ. On Linux, a right-click on a cell does not move the caret before the menu opens. Every command, though, acts on the live selection: `toggleBold`, `toggleLink`, `setBlockType` and the rest all read `$getSelection()`. A menu dimming Bold because the *clicked* node is in a raw block, while the caret sits in prose, would dim a command that would actually apply.

[^read-only]: Today a read-only editor's menu offers every editing command, and they all apply. Lexical's `setEditable(false)` blocks typing but not `editor.update`, which every command uses, and no command checks `getReadOnly()`. Restricting the menu is the established library behaviour (`TextInput`, `CodeEditor`). Making the command methods refuse is a public-API change for programmatic callers, so it is out of scope (see `## Non-Goals`).

[^toolbar-scope]: The menu and the toolbar invoke the same commands. If only the menu dimmed declined commands, the two would disagree at the same caret. The toolbar already greys out its Table and Link buttons from the selection state, so this extends an existing pattern by three lines plus one promoted field. The Link rule keeps its "inside a link" branch so Remove stays reachable from the popup. The Link popup's own Update/Remove buttons are unchanged.

[^source-mode]: Source-mode commands decline on text-level rules: Markdown flanking, escapes, cutting another construct (`toggleBold`'s JSDoc). Predicting them would mean running each transform speculatively on every caret move. Reporting `true` keeps source mode exactly as it is today.

---

## Implementation Notes

### Deviations from the plan's decisions

- **A right-click reads the selection the click made — against
  `[^selection-not-target]`.** The plan reads availability from the live
  selection on the ground that it is what the commands will act on. On Linux
  Chromium that does not hold for a mouse right-click. Measured with trusted
  mouse events (CDP `Input.dispatchMouseEvent`, headless Chromium 154), the
  order is `mousedown` → `contextmenu` → `selectionchange`: at `contextmenu`
  the browser has already moved its caret to the click point, but Lexical
  follows only on `selectionchange`. The handler therefore classified
  against the caret from before the click, and by the time an item was
  picked the commands acted on the new one. Caret in prose, right-click in
  the code block: Bold, Insert link… and Text style stayed enabled. Caret in
  the code block, right-click a prose word: they were dimmed though they
  would apply, a regression against the parent branch. The format
  checkmarks and the Cut / Copy / Insert link… state had read the same stale
  selection since before this branch. The first audit found this.
  `handleWysiwygContextMenu` now starts with an update that adopts the
  browser's selection: `$adoptDomSelection`, fed by Lexical's
  `$createRangeSelectionFromDom`. Three rules keep it from doing harm:
  - A selection equal to the editor's is left alone, so a format pending at
    an unmoved caret (Ctrl+B on a bare caret) survives the menu.
  - A held table selection is left alone, wherever the click lands: the
    browser has no cell selection of its own, and a right-click on selected
    cells must still act on all of them. Measured in the browser, Lexical
    itself keeps the table selection through a right-click on prose outside
    the table, so the commands go on acting on the cells and the menu, read
    from that selection, says so. (The menu's kind then still came from the
    clicked node; the review fixes below make it the table-cell menu.)
  - An adopted selection is given the format Lexical would give it: a
    collapsed one the format and style of the node at its anchor, a range
    the formats all its text has. A selection read from the browser carries
    none, and Lexical keeps a collapsed selection's format for the
    `selectionchange` that follows, so without this a letter typed into a
    bold word after a right-click came out plain. The first version of the
    fix had exactly that fault; the browser run caught it. The range rule
    matters because Code and Underline are read off the selection's format.
- **A new DOM seam escape, `DOM.source.readDocumentSelection(reader)`.** The
  adoption needs the browser's live selection, which Lexical resolves
  against its own DOM. `ARCHITECTURE.md` (*Minimize direct DOM access*)
  routes every read through `DOM.source`, and the existing selection reads
  were searched first: `getDocumentSelection()`, which `Body.ts` and
  `buildSelectionCopyMenuItems.ts` use for their menus, reports nothing for
  a collapsed selection and answers in handles, which Lexical keeps none of;
  `getDocumentSelectionText()` gives text only. Neither can carry a caret
  into Lexical, so the read is a named escape of the same shape as the
  sink's `mountView` and `createViewElement`, which already hand live DOM to
  Lexical: the live object goes to a callback and what comes back holds no
  reference to it. The modelled source returns `null` without calling the
  reader. `docs/concepts/dom-seams.md` describes it. The first version read
  the selection with Lexical's `getDOMSelectionFromTarget` straight from the
  component; the second audit found that it bypassed the seam.
  Availability is still read from the selection, as the plan says; what
  changed is that the selection is current when it is read. The keyboard
  path is untouched: there the two selections are already equal.
- **Commands that need a selection are unavailable without one — beyond the
  plan's table, and against T1 and its `NEUTRAL … canFormat: true`.** The
  plan's rule covered a range selection only, so with table cells selected,
  or with no selection, the menu and toolbar left enabled what would do
  nothing. Now the style, link, remove-link and block fields need a range
  selection, and `canFormat` needs a range selection or a table selection
  (the table plugin formats the selected cells). The two inserts make a
  caret of their own at the document's end, so they stay available. What
  follows from it: an editor nobody has clicked into reports `canFormat`,
  `canStyle` and `canSetBlockType` as `false`, `MarkdownDocumentPanel`'s
  format buttons and Text style start out disabled (T1 now asserts that, and
  that a caret enables them), and the existing classification tests that
  null the selection expect that record rather than the all-`true` one.
- **`canInsertObject` is two fields, `canInsertTable` and `canInsertImage`.**
  In a table cell `insertTable` does nothing (Lexical declines a nested
  table) while `insertImage` applies, so one field could not describe both.
  `canInsertTable` is also `false` where the insert position is inside a
  table.
- **Five fields are public, against `[^availability-source]`,** which kept
  only `canFormat` public. `MarkdownEditorSelectionState` now also carries
  `canStyle`, `canSetBlockType`, `canInsertTable` and `canInsertImage`. The
  toolbar's Insert dropdown needs the last three to dim its entries, and
  `canStyle` can no longer be derived from `canFormat` and `linkUrl`: with
  table cells selected the toggles apply and the style setters do not.
  `canLink` and `canRemoveLink` stayed private to the menu at this point;
  the review fixes below make them public, with `canSetBlockLayout`, for
  eight public fields, and round 2 adds the three table fields, for
  eleven. The toolbar's Text
  style rule is `canStyle` (the plan had `canFormat && linkUrl === null`),
  and its Insert dropdown, which the plan left alone, is now built at open
  time and dims each entry by `canSetBlockType`, `canInsertTable` or
  `canInsertImage`.
- **Building the editor can emit `"selectionstate"`.** Before the Lexical
  editor is built the neutral state stands in, with both insert fields
  `true`; how the document ends is not known without building it. The build
  now reports the state once when the document turns either field off. For
  a document ending in a paragraph, a list or a heading nothing is emitted,
  as before.
- **`insertTable` and `insertImage` decline when, with no selection, the
  document ends in a code block or a raw Markdown block.** Both put a caret
  at the document's end when there is no range selection, but tested for a
  text-only block before doing so, so the test passed and the insert went
  into the block: the image's Markdown as text inside the code block, and a
  table followed by a stray empty code block. They now test where the insert
  would land, and `canInsertTable` / `canInsertImage` read the same test.
  Found while pinning the no-selection availability.
- **A second functionality is on this branch: a read-only editor's surface
  is no longer `contenteditable`.** Seen during the manual run: after
  `setReadOnly(true)` the surface kept `contenteditable="true"`. Lexical
  leaves that attribute to its host, and `setReadOnly` only flipped
  Lexical's own flag. In the browser, typing into a read-only editor changed
  the shown text (`Edit on the leZZft`) while `getValue()` kept the
  document. `setReadOnly` and the `readOnly` option now drive the surface's
  `contenteditable`. It has its own code commit and changelog commit.
  This departs from `CodeEditor`, whose read-only mode keeps the content
  editable in the DOM and blocks edits in its state, so the caret, keyboard
  navigation and keyboard selection survive. Lexical offers no such mode:
  its read-only is a root that is not `contenteditable`, and keeping the
  root editable would mean cancelling every input route ourselves, which
  `beforeinput` cannot do for composition. So a read-only WYSIWYG surface
  shows no caret and takes no keyboard focus; text is still selected with
  the mouse and copied, and the context menu's Copy is reached by
  right-click only. That matches what the component docs already said of
  read-only ("dropping the caret and editing affordances"); the docs and
  the changelog now say it outright.

### Smaller differences

- **Line numbers had drifted; nothing the plan relies on had changed.** Two
  branches landed below this one after the plan was drafted
  (`markdown-editor-table-delete-merge`, `markdown-editor-column-paste`),
  and `$readFormatFlags` now reads a range through `$selectionHasFormat`.
  Every symbol the plan names was found by name. The decline checks were
  re-read on the current code and have the members the plan lists: the five
  toggles decline on `$selectionTouchesTextOnlyBlock()` and, through
  `$formatWritably(format, $declinesFormat)`, on `$selectionCoversSourceRun()`
  after the caret's expansion; `patchSelectionStyle` adds the anchor's
  enclosing link; `toggleLink(url)` adds `$selectionInNestedLinkRun()`;
  `removeLink` declines on `$selectionInNestedLinkRun()` alone;
  `setBlockType` and the two list toggles on `$selectionTouchesTableCell()`;
  `insertTable` and `insertImage` on `$selectionTouchesTextOnlyBlock()`.
  `insertImage`'s new table-edge route moves the image into a new paragraph
  rather than declining, so it adds no rule.
- **A7 uses another document, and has two rows.** The plan's
  `[a [b](https://y) c](https://x)` loads as three sibling link nodes holding
  plain text, with no nested-link run, so `$selectionInNestedLinkRun()` is
  `false` there and `removeLink()` changes the document. A nested-link run is
  a link whose text *all* sits in links nested in it, so the tests use
  `[[b - c](https://y)](https://x)`, as *Potential Challenges* allows. Its
  text is a `MarkdownSourceTextNode`, so a caret inside a word of it would
  expand onto a source run and `canFormat` is `false` too, which is what the
  toggles do there. The plan's row (`canFormat` still `true`) holds for a
  caret that expands to nothing, between the space and the `-`. Both rows are
  tested. Both also report `canStyle: false`, which the plan's row left out:
  the caret is inside a link, as in A6.
- **Existing `toEqual` expectations.** Step 10 asks for the all-`true`
  record on every exact `toEqual`. The two table-cell tests whose selection
  is in a cell expect `canSetBlockType` and `canInsertTable` `false`; the
  three that null the selection expect the no-selection record.
- **`findItem`, `submenuItemsOf`, `rowOf` and `SOME_FORMATS` moved to module
  scope** in `markdown-editor.test.ts`, out of the
  `MarkdownEditor context menu` describe, so the new describe shares them
  instead of copying them.
- **Tests beyond the plan's tables.** Tests drive
  `handleWysiwygContextMenu` itself, with an event target Lexical resolves to
  the root or to a text node (an object carrying the editor's
  `__lexicalKey_…` property), and read the items handed to the menu's `show`.
  For the right-click cases the seam's `readDocumentSelection` is spied to
  return the caret the browser would hold, as other suites spy
  `getDocumentSelectionText`: the modelled source has no selection. They
  cover the two measured cases, the checkmarks, Cut / Copy / Insert link…,
  the pending format, the held table selection and `$adoptDomSelection` on
  its own. Two test files are new and not in the plan's file table.
  `tests/component/markdown-editor-context-menu-mounted.test.ts` runs under
  jsdom with a real root element and the table selection observer, as
  `markdown-editor-table-edge-mounted.test.ts` does: it drives the real
  selection read (the browser's caret set through the DOM, then a real
  `contextmenu` event dispatched on the element, with the handler called
  from a listener on the root) and pins that a format toggle formats the
  cells of a table selection, which `canFormat: true` under a table
  selection rests on. (When this was written only the mounted observer
  formatted cells. Since the review fixes the editor's own format handler
  does, mounted or not, ahead of the observer's; round 2 below says what
  the mounted test pins now.) The handler
  has to run inside the dispatch: Lexical starts each update by deciding
  from `window.event` whether to read the browser's selection, and with no
  event at all it reads it and follows the caret by itself, which would
  pass these tests without the editor's own adoption. Their first version
  called the handler directly and did exactly that; the third audit found
  it. Each of the three adoption tests now fails when the seam read returns
  nothing, and the format one also when no format is carried over; both
  were checked by breaking the code. `tests/dom/read-document-selection.test.ts`
  covers the new seam read on the production and the modelled source.
  Others: a table selection
  resolving a root target to its anchor cell; `"selectionstate"` firing as
  `canFormat` turns; Edit link… and Remove link dimming separately; the
  empty-line Insert entries under each rule on its own; `setReadOnly`
  toggled after construction; the toolbar's Insert dropdown in a raw block,
  in a table cell and on the source surface. A9 runs every command of each
  unavailable field in every A case, including a caret in a cell, a table
  selection and no selection. T2 and T3 are one test.
- **Red phases.** First pass: with the tests written and no source change,
  44 tests in `markdown-editor.test.ts` failed (the R, M and availability
  cases, and the existing expectations step 10 updates) and T2/T3 and T4 in
  `markdown-document-panel.test.ts`; the A9 cases passed, pinning that the
  commands already declined. Second pass (the selection sync, the split and
  the range rule): 41 tests failed against the first pass's source. The
  adopted-format tests, the range-format test, the no-selection insert
  tests, the build-time report test and the read-only `contenteditable`
  tests each failed before their fix, as did the element-caret format test.
  The mounted tests and the seam tests were written after the code they
  cover and passed at once; that they depend on the code was shown
  afterwards by breaking it, as described above. One assertion of
  mine was wrong and was changed after the implementation: the A6 test
  expected bold inside a link to save as `[**text**](https://x)`, and the
  serializer writes `**[text](https://x)**`; it now asserts that the
  document changed and the selection reads bold, which is the contract.
- **JSDoc and style.** `getSelectionState` and `readActiveSelectionState`
  enumerate the reported fields, so both name the `can…` fields and their
  source-mode value. `$contextMenuNodeFor`, the read-only branch of
  `buildContextMenuItems` and `$selectionCoversSourceRun`'s callback assign
  each call's result before testing it, where the plan's listing put the
  call in the `if`. The docs name more dimmed groups than the plan's
  wording, and the *Read-only* section mentions the Copy-only menu.
- **Demo.** `MarkdownEditorPanel.ts` is not in the plan's file table. Its
  sample document gained one bullet pointing at Shift+F10 and the menu key;
  the sample already holds a table, a code block and a link reference
  definition, which the manual cases use.

### Verification

- **Manual cases X1–X7, first run, in Chromium** against this worktree's dev
  server on `#/md-editor`. The caret and selection were set through the DOM
  selection; Shift+F10 and the ContextMenu key were real key presses, and
  the right-clicks of X4, X5 and X7 were `contextmenu` events dispatched on
  the element, which do not move the caret. X1 and X2: caret in the `Tables`
  cell at x 254.8, line 520.5–539.5; the event targeted the root at
  (254, 530), a `PointerEvent` with `button: -1`, and the table-cell menu
  opened at that point. X3: the range `on the left` in the blockquote starts
  at x 266.9 on line 441.6–460.6; the text menu opened at (266, 451). X6:
  caret in `[commonmark]: https://commonmark.org`; the five format rows,
  Insert link… and Text style were dimmed in the menu, and Bold, Italic,
  Underline, Strikethrough, Code, Link and Text style in the toolbar.
- **Second run, with trusted mouse and key events** (CDP
  `Input.dispatchMouseEvent` / `dispatchKeyEvent`, headless Chromium 154),
  on the final code:
  - Caret in prose, right-click in the code block: Bold, Insert link… and
    Text style dimmed; the toolbar agrees; the caret is in the code block.
  - Caret in the code block, right-click a prose word: all enabled; the
    toolbar agrees.
  - Caret in plain prose, right-click the bold word `WYSIWYG`: Bold is
    checked. Escape, then `Q` typed: `**WYQSIWYG**`.
  - Ctrl+B on a bare caret at the end of `Left column.`, right-click at the
    caret: Bold is checked. Escape, then `Q`: `Left column.**Q**`.
  - X4: caret in the blockquote, right-click the `yes` cell: the table-cell
    menu; the caret is in the cell.
  - X5: caret in a cell, right-click on the root below the last block: the
    browser puts the caret at the end of the last block (the link reference
    definition) and the menu is the one for that caret.
  - Cells `Tables`..`yes` drag-selected: the toolbar keeps the format
    buttons enabled and disables Text style and Link. A right-click on a
    selected cell keeps the table selection; Cut, Copy, Insert link… and
    Text style are dimmed, the format rows and Table are not. A right-click
    on prose outside the table also keeps it, before and after the menu
    closes: the text menu opens with Insert link…, Block style and Text
    style dimmed, and the toolbar agrees.
  - Toolbar at load, no selection: format buttons, Link, Table and Text
    style disabled. Insert dropdown in the raw block: Table and Image…
    dimmed. In a cell: the four conversions and Table dimmed, Image… not.
  - X1 again: Shift+F10 in a cell gives the table-cell menu.
  - X7: `setReadOnly(true)`: the surface is not `contenteditable`, typed
    text changes nothing, a right-click offers Copy alone; back to
    editable, typing works.
- **Firefox was not run:** no Firefox tool was available.
- **Regression fuzz.** The two throwaway fuzzes kept from the branches below
  (table-edge deletion and column paste) were run at 3000 cases over seeds
  601, 1709, 2207, 3313, 4409, 5521, 6607, 7703, 8819, 9907 and 11003: once
  after the first pass, and again on the source as it stands after the
  second, after the third and on the final source, in a detached worktree
  of the branch, never committed. Each time all 22 result files were
  byte-identical to the ones saved at the parent
  branch's tip: 33000 table-edge cases with no failure, and 31951 pastes
  with the same 925 failures, which are the classes that branch's notes
  record.

### Audit

- **Round 1** found the right-click selection (blocking) and two missing
  blank lines before a multi-line statement; and, as advisories, the single
  `canInsertObject`, the docs gaps, the call in an `if`, and the selection
  state building the whole record for one field (it now reports five).
  All are addressed above.
- **Round 2** found, blocking: the selection read made outside the DOM seam
  (now the seam escape above); docs and JSDoc saying the two insert fields
  stay `true` with no selection, which the code and tests contradict where
  the document ends in a block that declines them (corrected); `canFormat`
  under a table selection asserted but pinned nowhere (the mounted test);
  and two stale commit messages (reworded). As advisories: no automated
  test of the real selection read (the mounted test); a range adopted from
  the browser taking its anchor node's format (it now takes the formats all
  its text has); the text-only test walking the selection twice per update
  (it is read once and passed on); the neutral state disagreeing with the
  inserts before the build (the build now reports); the held table
  selection kept on a right-click outside the table without being
  documented or tested (measured, documented, tested).
- **Round 3**, the last the audit allows, found, blocking: three of the
  mounted tests passing without the adoption they claim to cover, and the
  notes saying otherwise (the tests now dispatch a real event and were
  shown to fail without the code; the notes are corrected); and no
  changelog entry for the new required `DOMSource` member (added under
  Breaking changes, with a migration note, as earlier members have). As
  advisories: the Command API docs still saying every command no-ops with
  no selection (corrected for the two inserts); "with no selection" being
  imprecise where table cells are selected (reworded); the read-only fix
  departing from `CodeEditor` without saying so (said above, and in the
  docs and changelog); a caret adopted at an element point taking the
  block's text format even when the block has content, where Lexical does
  so only for an empty block (now the same, with a test); and the two
  format helpers following Lexical internals that could change on an
  upgrade (their JSDoc now says what they follow). These fixes have not
  been through a further audit round.

### Review fixes (combined review of 2026-10-05)

A review of the whole stack found twelve items on this branch (C-1 to C-12)
and a thirteenth was added (the other commands under a cell selection). All
are fixed here, folded into the commits they belong to. What changed against
the sections above:

- **The availability record says what the commands do, in both directions.**
  It has thirteen fields, read by three functions
  (`$readCommandAvailability`, `$readInlineAvailability`,
  `$readTableAvailability`). New: `canClearFormatting` (a selected text node
  carries a format `clearFormatting` would take off — the command and the
  field share `$formatOnceCleared`), `canSetBlockLayout` (alignment and
  columns need a range selection), `canInsertParagraphAroundBlock` (the
  anchor is in a quote, list, code block or table), `canEditTable` (the
  row, column, width, alignment and delete-table commands), `canMergeCells`
  and `canUnmergeCell`. Changed: `canRemoveLink` is `true` only inside a
  link; `canFormat` under a table selection is `true` only when a selected
  cell would take the format (`$someCellTakesFormat`), since the toggles
  skip a cell with no text (an empty one, or one holding an image alone)
  and one holding a run kept as source. The record and the toggles ask one
  function about a cell, `$cellTakesFormat`, defined below this branch
  (round 2; before it each had its own rule, and the two disagreed about a
  cell holding an image alone). This replaces the
  *Left as it is* entries for Clear formatting, Alignment and Columns, which
  stayed enabled where they did nothing. The Table submenu's entries were
  not on the review's list; they are dimmed by the same rule, because a held
  cell selection now always gets that submenu and only Merge cells acts on
  it.
- **`canInsertTable` and `insertTable` agree, and a declined insert touches
  nothing (C-1).** The branch below now removes a table-edge range before
  inserting, so `$tableInsertWouldNest` reports no nesting for one,
  whichever end the anchor is; any other range has both ends in one table
  or outside every table. `insertTable` and `insertImage` first read
  `$tableInsertApplies` / `$imageInsertApplies`, the functions the two
  fields read, and return before the seeding update. Before, a declined
  `insertTable` in a document ending in a table put a caret in the last
  cell, dropped a cell selection and fired `"selectionstate"`.
- **A held cell selection always gets the table-cell menu (C-2).** This
  replaces the deliberate behaviour of the first bullet above, where a
  right-click on prose outside the table gave the text menu, dimmed, while
  every item acted on the cells. `$contextMenuNodeFor` returns the
  selection's anchor cell whenever a table selection is held.
- **Eight public `can…` fields, not five (C-3, C-4); eleven since round
  2.** `MarkdownEditorSelectionState` gains `canLink`, `canRemoveLink` and
  `canSetBlockLayout`. The toolbar's Link button reads
  `(canLink && (hasSelectedText || linkUrl !== null)) || canRemoveLink`,
  and `LinkPopupPanel` takes the three link fields (`LinkPopupState`) and
  disables its two buttons one by one; the *Left as it is* entry about the
  popup is gone. `canLink` does not fold in "there is text to link": at a
  bare caret `toggleLink(url)` links the whole text run, so the field says
  only where the command declines, as the menu's Insert link… already
  assumed (round 2 narrows this: it is also `false` where there is nothing
  a link could hold). `canSetBlockLayout` was not asked for by name: the review wants
  Alignment and Columns dimmed in the toolbar too, and no existing public
  field says "there is a range selection, on the WYSIWYG surface". The
  toolbar's Alignment and Columns buttons are disabled on it.
- **A selection running out of its table no longer counts as "in a table".**
  Found by the new direction of the consistency test: for a range anchored
  in a cell with its focus outside the table, `insertTableRow`,
  `deleteTableRow`, `insertTableColumn` and `deleteTableColumn` threw
  (`Expected to find a parent TableCellNode`) inside Lexical's helpers.
  `$getEnclosingTableCellNode` now returns no cell for a table-edge range,
  so every table command is a no-op there, `inTable` is `false` and the
  toolbar's Table button is disabled. The fault predates this stack. No
  test pinned `inTable` or the button for that shape until round 2.
- **`"selectionstate"` in source mode, and at build time (C-5).**
  `_lastSelectionState` is seeded from the surface the editor is constructed
  showing, so an editor built in source mode no longer fires on its first
  caret move whatever it changed. `setMode("wysiwyg")` shows the WYSIWYG
  surface before it builds or loads the Lexical editor, so the build-time
  report lands with that surface showing. The other direction was left
  wrong here and is fixed in round 2.
- **The consistency test runs both ways (C-6).** Each of 23 selection cases
  lists the fields available there; every command of an unavailable field
  must leave the document unchanged, every command of an available one must
  change the document or the selection, a declined insert must leave the
  selection alone and report nothing, and every field must have a case on
  each side. Round 2 found "the document unchanged" too weak a test of
  "nothing happens", and the 23 cases too few; both are changed below.
- **A read-only editor refuses its editing commands on both surfaces
  (C-7), in the read-only commit pair.** This replaces the last *Left as it
  is* entry. Every editing command returns first when `getReadOnly()` (28
  guards, and `paste()`'s, at the time; since round 2 one test in
  `commandApplies`, and a guard each in `toggleLink`, `cut()` and
  `paste()`); `cut()` and `paste()` also on the source surface, whose
  `CodeEditor` guarded `replaceRange` but not those two (round 2 guards
  them there). The selection state's `can…` fields are all `false` while
  read-only (one override in `readActiveSelectionState`), and `setReadOnly`
  reports the change, also on an editor not built yet. The toolbar's Table
  button read `getReadOnly()` as well, a second rule beside the record,
  which round 2 removes. `setValue` stays allowed: `CodeEditor.setValue`
  is not guarded either, and source mode forwards to it. The WYSIWYG
  refusal is silent; there is no flash to match the source editor's.
- **Smaller ones.** `ContextMenuTarget.availability` is required and the
  fallback constant is gone (C-8); `focus()`'s JSDoc says a read-only
  WYSIWYG surface takes no focus (C-9); the test copy of the demo `SAMPLE`
  in `markdown-source-preservation.test.ts` has the Shift+F10 bullet, so
  demo and copy are in step on this branch (C-10); calls are hoisted out of
  `if` conditions in `$formatOfRange` and `$carryFormatOfLanding`, which
  also uses `$orderedPoints` (C-11); `ensureEditor` held 27 substantive
  lines, comments and brace-only lines left out, and this branch registered
  nothing in it: its one line there was the build-time report (C-12).
  Round 2 splits the build out of it (`buildEditor`).
- **The other commands under a cell selection (C-13).** Measured headless
  and with the mounted table observer: the three style setters,
  `toggleLink`, `removeLink`, `clearFormatting`, `setBlockType`, alignment,
  columns, the two insert-line commands and every table command but
  `mergeTableCells` leave the document as it is; `insertTable` and
  `insertImage` go to the document's end; the format toggles go cell by
  cell under the writable rule (`$formatCellsWritably`, which the same
  review added below this branch, so that the cells are formatted under
  that rule and not by Lexical's table plugin). The record reports each of
  them `false`. This entry used to say that the two list toggles do
  nothing either, and that nothing below this branch had changed; neither
  was true. The list toggles replaced each selected cell's paragraphs by
  new ones — the saved Markdown the same, the nodes not, and an undo step
  that undid nothing — because their guard asked a question whose answer
  is always "no" for a table selection, and the test compared the saved
  Markdown alone. Round 2 fixes the guard below this branch, and the test
  here.
- **How the tests were written.** The two-way consistency test and the
  read-only tests were written before their code and failed first (the
  read-only run: 28 failures). The tests for the menu node, the dimmed
  items, the toolbar's Link and layout rules, the popup's buttons and the
  two `"selectionstate"` fixes were written after the code they cover; each
  was then shown to fail by breaking that code, 24 breaks in all, and each
  of the 28 read-only guards was removed in turn and caught.

### Verification of the review fixes

- **Chromium**, through a devtools session against this worktree's dev
  server. Real mouse clicks, drags and key presses, except right-clicks: the
  session has no right-button input, so each was a `contextmenu` event
  dispatched on the element after moving the browser's caret there.
  - Cells `Tables`..`yes` drag-selected: the toolbar keeps the format
    buttons and disables Link, Text style, Alignment, Columns and Table. A
    `contextmenu` on prose outside the table, and one on a selected cell,
    both give the table-cell menu: Cut, Copy, Insert link…, Text style,
    Clear formatting and the Insert line items dimmed; the format rows,
    Paste and Table enabled; in Table only Merge cells enabled. The cells
    stay selected. A real click on the Bold row gives
    `| **Tables** | **yes** |`.
  - Insert ▸ Table over a selection from the blockquote into a cell, made
    forward (a real drag) and backward (set through the DOM selection, which
    Lexical followed): `canInsertTable` is `true`, the Insert dropdown dims
    the four conversions and leaves Table and Image… enabled, and a real
    click on Table removes the selection with its table and inserts the new
    one. The blockquote is split at the caret and an empty quote is left
    after the new table; a plain caret at a quote's end does the same, so
    that is how a table goes into a quote, not something this selection
    adds.
  - A click into a link nested in a link: `linkUrl` is set, both link fields
    are `false`, the Link button is disabled. In an ordinary link the popup
    shows Update link and Remove link, both enabled.
  - `setReadOnly(true)`: one `"selectionstate"`, the surface not
    `contenteditable`, every toolbar control but Insert and the source
    toggle disabled, all six Insert entries dimmed. Typed keys change
    neither the shown text nor the value, Shift+F10 opens nothing, a
    `contextmenu` offers Copy alone, and `toggleBold()`, `insertTable()`,
    `setBlockType()` and `cut()` from the console change nothing. Back to
    editable: one event, the toolbar as before.
  - Source mode: the switch fires one event and disables Alignment, Columns
    and Table. Three arrow-key moves inside plain text fire none; a move
    onto an empty line and one into a bold run fire one each.
  - Shift+F10 with the caret in a cell: the table-cell menu, Clear
    formatting dimmed, and in Table only Merge cells and Unmerge cell
    dimmed.
- **The first-event fix for an editor constructed in source mode** is
  covered by its unit test only: the demo constructs its editor in WYSIWYG
  mode.
- **Checks.** On this branch and at the tip of the stack two branches up:
  `typecheck`, `typecheck:test`, `lint`, the whole vitest suite (550 files;
  13069 tests here, 13113 at the tip), `docs:api` with no warning,
  `docs:llms:check` and `build:lib`, all passing. The two counts are that
  run's; later fixes added tests, and the counts as they stand are given
  with round 2's checks below, and round 3's after those.
- **Regression fuzz**, at the tip of the stack, 3000 cases over each of the
  eleven seeds, the harnesses copied in and removed again. Table-edge
  deletion, in the variant the branch below left (it counts a Shift+Enter
  that changes nothing as declined): 33000 cases, no failure. Column paste:
  31951 pastes with the same 925 failures as before. All 22 result files
  are identical to the ones saved before the review fixes.

### Review fixes, round 2 (re-review of 2026-10-05/06)

Three reviewers re-read the fix round. Seventeen of their findings were on
this branch (A-1 to A-17, two of them shared with the branch that owns the
format and block-conversion guards). All are fixed, folded into the commits
they belong to. What changed against the sections above:

- **The contract, and how the commands keep it (A-5).** For every field of
  the availability record and every command it covers: where the field is
  `true` the command changes the document or the selection; where it is
  `false` the command changes nothing — not the saved Markdown, not a node,
  not the selection, not the undo history — and fires no event. The fix
  round had that for the two inserts only. Every command now starts by
  reading its own field (`commandApplies(field)`, which reads
  `$readCommandAvailability`), so a command and its field cannot come
  apart. The checks the commands made up front in its place are gone:
  `declinesInTableCell` altogether, and `declinesInTextOnlyBlock` from every
  command but `toggleLink(null)`, the unlinking no field covers. A format,
  style or link command no longer widens a caret to its word and then
  declines; that entry is gone from *Still open*.
- **The record is `false` where a command had nothing to act on (A-4).**
  `canFormat` and `canStyle` need a caret, which takes the format or style
  as pending, or a range holding text (`$rangeHoldsText`): a range from the
  end of one block to the start of the next, over an image or over a line
  break holds none. `canLink` needs something a link could hold
  (`$selectionHoldsLinkable`): text, an image, or at a caret the text run
  it sits in; a caret in an empty block has nothing. One point differs from
  the finding's wording: a range over an image alone keeps `canLink`,
  because `toggleLink` wraps the image (`a ![i](/i.png) b` gives
  `a [![i](/i.png)](https://z) b`), which was measured. `$selectedSlices`
  is exported from `markdownWritable.ts` for the text test.
- **The list toggles toggle (A-3).** On this surface they dispatched
  Lexical's list insert whatever the selection. In a list of that kind the
  insert replaces the list node by an equal one: nothing to see, an undo
  step that undoes nothing, and a loose list made tight, while
  `canSetBlockType` reported the command available and the JSDoc and the
  docs said "or out of one". Now, when every block the selection touches is
  an item of a list of that kind (`$selectionLiesInListOfType`), the items
  leave the list: `toggleList` calls `setBlockType("paragraph")`, so each
  becomes a paragraph and the list is split around it. That is what the
  source-mode toggle does to the same lines: on the eight shapes a test
  runs through both surfaces (a flat list at its first and at a middle
  item, two items, a nested item, an item holding a nested list of either
  kind, a loose list, a list in a `:::` column) the two results read the
  same in the viewer. They differ for a task item, which source mode
  declines to take out and this surface takes out, its marker shown as the
  text it is. The other direction was not touched: a toggle of the other
  kind converts the selected lines in source mode and, through Lexical's
  insert, the whole list here. Lexical's `$removeList`, which the hand-out proposed, was measured and
  not used: it dissolves the whole top-level list, nested lists of the
  other kind included, where source mode and the documented contract take
  out the selected blocks. The route is the one `setBlockType` already
  takes, in one discrete update, so the writable-state transforms run on it
  and it is one undo step; the serializer and the importer are untouched.
  Twelve shape cases pin the result, its reload, its parity with the viewer
  and the one undo step: a flat list, two items, a numbered list, a nested
  item, an item holding a nested list, a numbered item nested in a bulleted
  list, a task item, a loose list, a list in a `:::` column, the other
  kind's toggle (which converts), a range from a bulleted list into a
  numbered one and one into a paragraph (which make a list). Two limits. A
  list inside a quote is a raw Markdown block on this surface, so a toggle
  there is the raw block's. And an item whose text sits in a paragraph of
  its own inside the item is no item to the test, so the toggle there still
  dispatches the insert; the importer builds no such item, and whether an
  edit can make one was not examined.
- **The table fields are public, and the toolbar's Table button reads them
  (A-8).** `MarkdownEditorSelectionState` gains `canEditTable`,
  `canMergeCells` and `canUnmergeCell`, for eleven public `can…` fields;
  `canClearFormatting` and `canInsertParagraphAroundBlock` stay private to
  the menu, the toolbar having no control for them. The Table button is
  enabled on `canEditTable || canMergeCells || canUnmergeCell`, so Merge
  cells is reached with cells selected, and the dropdown dims each entry on
  its own field, as the context menu's Table submenu does. The button's
  second rule, `inTable && !getReadOnly()`, is gone: read-only follows from
  the fields. `inTable` is documented as where the selection is, not what
  applies; it stays `true` in a read-only editor's cell. The three fields
  are `false` in source mode, where the table commands are no-ops. That
  entry is gone from *Still open* too.
- **No hand list can leave a field out (A-10).** `ReportedAvailability`
  picks the selection state's fields by the shape of their name
  (`can${string}`). `$readSelectionState` copies them through one function
  typed by it and `NO_COMMAND_APPLIES` is typed by it, so a `can…` field
  added to the state does not compile until both give it; taking
  `canUnmergeCell` out of `NO_COMMAND_APPLIES` was tried and fails the
  typecheck. `selectionStatesEqual` compares every key the state has, where
  it named each field.
- **The consistency test tests "nothing happens" (A-1), on more cases.**
  For a command of an unavailable field it now compares the saved Markdown,
  every node by key and type, and the selection (its points, and the
  format and style pending at it), and asserts that no Lexical update
  listener ran, that neither `"change"` nor `"selectionstate"` fired, and
  that Undo can take as many steps as in an editor the command was never
  run on. The declined-insert test is part of it now. 35 cases, twelve of
  them new: a cell selection holding an image-only cell with a bold cell,
  and of image-only cells (A-2); a range from a block's end to the next
  block's start, over an image alone, over a line break; a caret in an
  empty paragraph; carets and ranges in bulleted, numbered and task lists,
  and a range from one kind of list into the other. Run against the source
  as the fix round left it, 33 tests failed. The read-only variant of the
  test asserts the same.
- **`$someCellTakesFormat` asks `$cellTakesFormat` (A-2),** the function
  the toggles pick the cells by, defined below this branch.
- **`inTable` for a selection running out of its table is pinned (A-6).**
  Tests cover `inTable`, `tableColumnAlignment`, the three table fields and
  the toolbar's Table button for that shape, made in either direction.
  Reading the anchor's cell directly was tried in both places it could be
  read: in `$readSelectionState` it fails one test, in
  `$readTableAvailability` three.
- **A switch to source reports with the source surface showing (A-7).**
  `setMode("source")` loaded the source editor before it showed it, and a
  mounted source view reports its change at once. The card is flipped first
  now, in both directions. The mirror test stands a view in for the mounted
  one and failed before the change.
- **One `"selectionstate"` for the first `setValue` (A-13).** The build of
  the Lexical editor is split out of `ensureEditor` as `buildEditor`, which
  reports nothing; `ensureEditor` adds the build-time report, and
  `setValue` on an editor not built yet builds without it, so only the
  loaded document's state is reported.
- **The mounted test says what it pins (A-9).** Its header and these notes
  said the table selection observer is what formats selected cells. The
  editor's own handler does, ahead of the observer's, which formats
  unchecked. A new mounted test pins that order: a selected cell holding a
  run kept as source is left as it is. Making the editor's handler pass a
  table selection on, so that the observer's takes it, fails that test.
- **Smaller ones.** The three `availability?.` on the now required field
  and the two test titles naming the removed `getLinkUrl()` are corrected
  (A-11); `updateSelectionState`'s JSDoc lists the build-time call (A-12).
- **In the read-only commit pair.** One test in `commandApplies` refuses
  every command a field covers, before the Lexical editor is so much as
  built, in place of the 28 guards; `toggleLink`, `cut()` and `paste()`,
  which no field covers entirely, keep a guard each. `CodeEditor.cut()`
  and `paste()` are refused on a read-only editor as its `replaceRange` is,
  with the `"readonlyedit"` event and the flash (A-14); `MarkdownEditor`
  hands both to the source editor before its own guard, so a read-only
  source surface flashes for them as for every other command. That closes
  the last *Still open* entry of the fix round, in `CodeEditor` itself and
  not around it. `setContentEditable` no longer makes a read-only surface
  editable: the editor remembers what was asked for and the surface gets it
  when `setReadOnly(false)` comes (A-15). `isSourceMode()` is assigned
  before it is tested in every command this round touched — `cut()`,
  `paste()`, alignment, columns and the nine table commands — and so is
  `isDirty()` in `buildEditor` (the rest of G-5).

### Verification of round 2

- **Checks.** On this branch: `typecheck`, `typecheck:test`, `lint`, the
  whole vitest suite, `docs:api` with no warning, `docs:llms:check` and
  `build:lib`, all passing. The suite holds 550 files and 13201 passing
  tests here (2 todo), 13246 on the branch above and 13274, in 551 files,
  at the tip two branches up, where the same checks pass. These were the
  counts after round 2 (round 3's are below); the ones under *Verification
  of the review fixes* are that round's. The suite was also run at the feature commit on its
  own, before the read-only pair, while that commit was being amended: 550
  files, 13147 tests, all passing.
- **Regression fuzz**, at the tip of the stack, 3000 cases over each of the
  eleven seeds, the harnesses copied in and removed again. Table-edge
  deletion, in the variant that counts a declined Shift+Enter as declined:
  33000 cases, no failure, all eleven result files identical to the ones
  saved after round 2's fixes on the branches below. Column paste: 31951
  pastes with the same 925 failures, all eleven files identical to the
  ones saved at the column paste branch.
- **Chromium**, through a devtools session against the tip's dev server, on
  the demo's MD Editor. Real input: the clicks on toolbar buttons and menu
  entries, the clicks into text, Ctrl+Z, Ctrl+B and Escape. Not real: cell
  selections were made by pointer events dispatched from the page
  (`pointerdown` on one cell, `pointermove` onto the next, `pointerup`),
  since the session's drag is an HTML drag-and-drop and selects no cells;
  and the documents other than the sample, the read-only state and the
  calls named below were made from the console.
  - Cells `Tables`..`yes` selected: the Table button is enabled, with the
    format buttons; Link, Text style, Alignment and Columns are disabled.
    Its dropdown dims every entry but Merge cells, and a click on that one
    merges the two cells.
  - The cells of `| ![i](…) | **d** |` selected: `canFormat` is `true`, and
    a click on Bold gives `| ![i](…) | d |`, the cells still selected.
  - With those cells selected the Insert dropdown dims the four block
    conversions, and `toggleUnorderedList()`, `toggleOrderedList()` and
    `setBlockType("h1")` leave the very editor state object in place, with
    no update run. One Ctrl+Z then brings `**d**` back: the step undone is
    the Bold, and no dead one stands before it.
  - A click into `two` of a three-item bulleted list, then Insert ▸
    Bulleted list: `- one`, `two`, `- three`, the caret still in `two`.
  - A click into `<span>` in `kept <span>x</span> source`: the format
    buttons, Link and Text style are disabled, and `toggleBold()`,
    `toggleInlineCode()`, `setTextColor()` and `toggleLink()` leave the
    caret collapsed where it was. Ctrl+B there is listed under *Still
    open*.
  - Mode switches with a `"selectionstate"` listener noting which surface
    shows: to source (the switch that mounts the source view), back, and to
    source again with the view mounted and the caret in a table cell. One
    event each, each with the incoming surface showing.
  - `setReadOnly(true)` with the caret in a cell: one event; `inTable`
    still `true`, `canEditTable` `false`, the Table button disabled with
    every control but Insert and the source toggle; the surface
    `contenteditable="false"`, and still so after
    `setContentEditable(true)`; `toggleBold()`, `insertTableRow()`,
    `deleteTable()` and `cut()` change nothing. `setReadOnly(false)` brings
    the toolbar and `contenteditable="true"` back.
  - The console held one warning, four times over: Lexical's "an editor
    update … ran while a read-only context was on the stack". The first
    was raised inside a `setValue` made from the console that replaced a
    document whose table held the selection; six more documents loaded one
    after another at the end raised it once, on the first, which again
    replaced such a document. It was not traced further, and whether the
    branches below raise it was not checked.
- **Not run:** Firefox and WebKitGTK, as before, and no right-click: this
  round changed nothing in the menu's own path.

### Review fixes, round 3 (final review of 2026-10-06)

A third review read round 2. Ten of its findings were on this branch and the
two above it (U-1 to U-10). All are fixed, folded into the commits they
belong to, except U-10, which asked for a record. What changed against the
sections above:

- **A call that asks for what is already there changes nothing (U-1).** The
  docs and *Still open* said that `setBlockType("paragraph")` in a paragraph
  changes nothing. It left the saved Markdown alone and fired no event, but
  it replaced the block by a new one and added an undo step that undid
  nothing; `setTableColumnAlignment` and `setTableColumnWidth` with the
  column's own value kept the nodes and added the same dead step. Each is
  one click away: Block style ▸ Paragraph on a paragraph, Align column ▸
  the checked entry. `setBlockType` now reads `$selectedBlocksHaveType`, and
  the two table setters `$enclosingColumnHasAlignment` and
  `$enclosingColumnWidth`, and each returns without updating the document
  when the value is already set. The blocks are the ones the list toggles went by
  (`$blocksTouchedBy`, pulled out of `$selectionLiesInListOfType`), and the
  column's cells come from one walk (`$enclosingColumnCells`) that the read
  and `$setEnclosingColumnAlignment` share.
  - *Two more of the class.* The review found `setBlockAlignment(null)` and
    `setColumnCount(1)` true no-ops outside a `:::` block. Inside one,
    `setBlockAlignment` with the block's own alignment and `setColumnCount`
    with its own count and gap wrote the value again and added the dead
    step (Alignment ▸ the checked entry). Both now write only what differs,
    inside their update, which then commits nothing.
  - *What a same-type `setBlockType` also did.* It rewrote the block in the
    standard form. Measured before the fix: `head\n====` became `# head`,
    `# head #` became `# head`, a `~~~` fence or an indented code block
    became a backtick fence, and a fence opened with `ts` lost its
    language. All are left as written now.
  - *The keyboard comes back.* A menu row or a toolbar button takes focus
    off the surface before its command runs, and it was the dead update that
    gave it back: Lexical writes its selection to the browser on an update,
    and the browser moves focus with it. This round's first browser run
    showed the other side of the fix. After Block style ▸ Paragraph on a
    paragraph `document.activeElement` was the body, and typing went
    nowhere until a click. The five commands now hand focus back themselves
    where they find nothing to change (`refocusSurface`, which is Lexical's
    own `focus()`, as `copy()` and `paste()` call it after a menu click):
    the three that return early before they return, alignment and columns
    after their update. That last also covers `setBlockAlignment(null)` and
    `setColumnCount(1)` outside a `:::` block, where the keyboard was lost
    before this stack. Lexical's `focus()` is an update of the selection
    alone — no node changes, no undo step, neither event — and without a
    mounted surface it does nothing, so the headless rows hold as written.
    Seven mounted rows read the browser's selection, which jsdom drops
    with the focus and Lexical writes back; that a browser moves the focus
    with it is what the Chromium run below shows. They fail without the
    call.
  - *The field.* `canSetBlockType`, `canEditTable` and `canSetBlockLayout`
    stay `true` there: a field covers a command, not a call, and the docs
    page lists the calls that change nothing.
  - *Rows,* written first, 18 of them failing: twenty such calls, each
    asserting the saved Markdown, every node by key and type, the selection,
    that no update listener ran, that neither event fired, and the undo
    depth; that the edit made before such calls is the one Undo takes back;
    and that a range touching a block of another type still converts. Each
    of the three returns and the two guarded writes was taken out in turn
    and caught.
- **`inTable` is documented for what it reports (U-2).** It is `false`
  while whole table cells are selected, as round 2's test in
  `markdown-document-panel.test.ts` pins, and for a selection running out
  of its table; "where the selection is" covered neither. The JSDoc, the
  component page, the changelog and the migration note say "where a caret
  or a text selection is" and name the two cases.
- **One `"selectionstate"` for the first switch to WYSIWYG, whatever was
  loaded before it (U-3).** A source view not mounted yet takes `setValue`
  without reporting a change, so the value the Lexical editor is built from
  stays the constructor's. `setMode("wysiwyg")` built through
  `ensureEditor`, which reported that document's state, then loaded the
  real text and reported again: for a constructor document ending in a code
  block, both inserts `false`, then `true`. It now builds through
  `buildEditor`, as `setValue` does, and reports the loaded document alone.
  One test, failing before.
- **A point on a block is judged as the place it names (U-4).** A
  programmatic selection can hold a point on a block itself, between its
  children; the browser's arrives as points in text. `$rangeHoldsText` took
  a range between the two forms of one place (the paragraph at offset 1,
  and the end of the text before an image) for the whole text node, so
  `canFormat`, `canStyle` and `canLink` were `true` over a range of no
  width, where the style setters did nothing. It now judges a copy of the
  selection whose block points are moved into the text beside them
  (`$moveBlockPointsIntoText`). The same range between two blocks, held as
  two block points, selects no leaf, so Lexical's list insert did nothing
  with `canSetBlockType` `true`; `toggleList` moves the live selection's
  block points into text first, and the toggles take both blocks as they do
  for the range in text points. Four cases join the consistency test, which
  has 39; six of their tests failed before.
- **Calls out of `if` conditions (U-5).** Here: the mode tests in `setMode`
  and `setValue`, the link test in `patchSelectionStyle`, and the two
  `canUnwrap()` tests. The lines of the review's list that lower branches
  own were changed there: `copy()`'s guard on the source-mode-editing
  branch, and three tests in `patchSelectionStyle`, `toggleLink` and
  `removeLink` on the marked-import branch.
- **One rule per command, and every gate pinned (U-6).** Fourteen of the 27
  `commandApplies` gates could be replaced by `true` with A9 still green,
  because a guard inside the update repeated the rule: `removeLink`,
  alignment, columns, the two insert-line commands and the nine table
  commands. A9 now also asserts that a command of an unavailable field
  starts no Lexical update at all (a spy on the editor's `update`), and
  each of the 27 gates, replaced in turn, fails it. The guards that only
  repeated the rule are gone: the nested-link test in `removeLink`,
  `$selectionIsInTableCell()` around the four row and column commands and
  `unmergeTableCell` (the function went with them), and the count test in
  `mergeTableCells`. What is left inside the updates narrows a type on the
  way to the node — a range selection, the enclosing link, the enclosing
  cell — and decides nothing the gate has not.
- **In the read-only commit pair: `CodeEditor.format()` (U-7).** It was the
  one programmatic edit besides the documented `setValue` that a read-only
  `CodeEditor` did not refuse. It is refused as `replaceRange`, `cut()` and
  `paste()` are — the same guard, the `"readonlyedit"` event and the flash
  — before a formatter is loaded or the re-indent fallback runs; the
  promise resolves. Two tests, failing before. `CodeEditor` gained no
  Markdown-specific API. The docs page, the changelog entry and the
  migration note name it.
- **Docs (U-8, U-9).** The changelog said every command declines before it
  touches the document or the selection; it now gives the exception the
  component page gives (a format, style or link the save could not write as
  shown is declined after trying, a caret left expanded). The component
  page's rows for `cut()` and `paste()` say they are refused while
  read-only. U-9's other two parts are on the two branches above.

### Verification of round 3

- **Checks.** This round changed every branch of the stack: the lowest by
  one hoisted guard, which the sixteen above it inherit. Each was checked
  at its tip: `typecheck`, `typecheck:test` and the whole vitest suite on
  all seventeen, and `lint`, `docs:api` with no warning, `docs:llms:check`
  and `build:lib` on this branch, on the columns-fixes branch three below
  it and at the tip. All pass. The suite holds 550 files and 13270 passing
  tests here (2 todo), 13315 on the branch above and 13343, in 551 files,
  at the tip. It was also run at the feature commit on its own, before the
  read-only pair: 550 files, 13210 tests, all passing.
- **Regression fuzz**, at the tip of the stack, 3000 cases over each of the
  eleven seeds, the harnesses copied in and removed again. Table-edge
  deletion, in the variant that counts a declined Shift+Enter as declined:
  33000 cases, no failure. Column paste: 31951 pastes with the same 925
  failures. All 22 result files are identical to the ones saved after round
  2, the changes to Enter over a range and to the emptied list on the
  branches below included.
- **Chromium**, through a devtools session against the tip's dev server, on
  the demo's MD Editor, with a document loaded from the console. Real
  input: the clicks into text, on menu rows and on the Underline button,
  the typed keys, Shift+F10 and Ctrl+Z. Not real: the cell selection, made
  by pointer events dispatched from the page as in round 2.
  - A click into a paragraph, `Q` typed, Shift+F10, Block style ▸
    Paragraph: the node keys are the same, neither event fires, and the
    surface has the keyboard again. One Ctrl+Z takes back the `Q`, and a
    key typed next lands in the paragraph. Run before the focus was handed
    back, the same click left `document.activeElement` on the body.
  - The body cells `C++` and `Rust` of a one-column table selected, then
    the Underline button: `C\+\+` and `++Rust++`. A second click: `C++` and
    `Rust`, the cells still selected. Ctrl+Z brings the underline back,
    and a second Ctrl+Z takes it off: each press is one undo step. (The
    fix for this is on the marked-import branch.) The toolbar click leaves
    the keyboard on the button while cells are selected, since Lexical
    writes no browser selection for a cell selection; the surface was
    focused from the console before Ctrl+Z. This round did not change
    that, and whether it was so before this stack was not measured.
  - The console held Lexical's "an editor update … ran while a read-only
    context was on the stack" twice, after the second document was loaded
    over one whose table held the selection: the warning *Still open*
    records.
- **Not run:** Firefox and WebKitGTK, as before, and no right-click: the
  menu was opened from the keyboard.

### Still open

- **Not run: Firefox and WebKitGTK.** No tool for either was available, in
  the first runs or in the review fixes. The plan asks for Firefox; its
  footnote names WebKitGTK as the Tauri target. On Windows `contextmenu` is
  raised on mouse-up, after Lexical has followed the caret, so the adoption
  should find nothing to do there; that was not measured either. Trusted
  right-button input was used in the second run above, not in the runs of
  the two review rounds.
- **Decided by the user on 2026-10-06: where the scope grew past the plan's
  explicit decisions.** Each item is recorded above with its reason; the
  user was asked about these one by one.
  - Eleven public `can…` fields where `[^availability-source]` kept one:
    `canFormat`, `canStyle`, `canLink`, `canRemoveLink`, `canSetBlockType`,
    `canSetBlockLayout`, `canInsertTable`, `canInsertImage`, and, since
    round 2, `canEditTable`, `canMergeCells` and `canUnmergeCell`.
    Accepted as implemented: all eleven stay public, under these names.
  - Format, Text style, Alignment and Columns buttons that start disabled
    until the editor has a caret, where T1 had the format buttons enabled.
    Accepted as implemented.
  - An Insert dropdown that dims its entries, which the plan left alone,
    and, since round 2, a Table button that is enabled while cells are
    selected and a Table dropdown that dims its entries. Accepted as
    implemented.
  - The new required seam member `DOMSource.readDocumentSelection`, which
    breaks a custom `DOMSource`. Accepted as implemented.
  - A read-only editor that refuses its editing commands on both surfaces,
    a breaking change with a migration note; with it, since round 2, the
    source surface's `cut()` and `paste()`, which a read-only `CodeEditor`
    refuses. The refusal is kept as implemented. A follow-up plan,
    `markdown-editor-readonly-keyboard-selection`, lets a read-only WYSIWYG
    editor take focus and have its text selected and copied by keyboard.
  - `inTable` being `false` for a selection that runs out of its table,
    and while cells are selected. Accepted as implemented.
  - Since round 2, `toggleUnorderedList` and `toggleOrderedList` taking the
    selected items out of a list of their kind on the WYSIWYG surface,
    where they changed nothing a save would show. Accepted as implemented.
    A follow-up plan, `markdown-list-toggle-task-item-parity`, aligns what
    the toggles do with a task item, which the WYSIWYG surface takes out of
    its list and source mode declines.
- **Decided by the user on 2026-10-10: what the user was not asked about
  on 2026-10-06.** Each item is recorded above with its reason.
  - With the read-only refusal, since round 2, `setContentEditable(true)`
    no longer making a read-only surface editable, and, since round 3, a
    read-only `CodeEditor` refusing `format()` as well. Accepted as
    implemented.
  - Since round 3, `setBlockType`, `setTableColumnAlignment` and
    `setTableColumnWidth` doing nothing, and adding no undo step, when the
    value is already set, and `setBlockAlignment` and `setColumnCount`
    likewise inside a `:::` block. With it, a same-type `setBlockType` no
    longer rewrites a heading or a code block in the standard form, and a
    code block keeps its language. Accepted as implemented.
- **Paste stays enabled where it does nothing.** `paste()` needs a range
  selection, so under a cell selection, or with none, the menu's Paste does
  nothing. The shared clipboard rows never dim Paste, by their own
  contract; changing that touches `CodeEditor`'s menu as well.
- **Ctrl/Cmd+B at a caret in text kept as source leaves a format pending.**
  Seen in the browser run of round 2. The toggles decline there, their
  field being `false`; the shortcut is not `toggleBold()` but Lexical's
  format command, whose handler, below this branch, declines a range that
  covers such a run and not a caret inside one. The document and the caret
  stay as they are, and the selection takes the pending bold. The third
  review examined what text typed next does with it: with the caret at
  offset 3 of `<span>` in `kept <span>x</span> source`, Ctrl+B and then `Q`
  give `kept **Q**x</span> source`, where `Q` alone gives
  `kept Qx</span> source`. The result reloads identically and matches the
  viewer; no event fires for the pending bold, and the state's `bold` stays
  `false`. Left as it is.
- **The Lexical warning seen in round 2's browser run is most likely
  upstream.** "An editor update … ran while a read-only context was on the
  stack", raised inside a `setValue` that replaced a document whose table
  held the selection. The third review did not reproduce it in nine mounted
  jsdom combinations. Its reading: `@lexical/table` 0.49.0's mutation
  listener runs inside `editor.read('latest')`, and its observer dispatches
  `SELECTION_CHANGE_COMMAND` from there. Not traced further.
- **Source mode: `canRemoveLink` where `removeLink()` declines.** In the
  outer part of `[[b - c](https://y)](https://x)` the field is `true` and
  the command declines. This falls under what the docs say of source mode:
  where a command declines there is not predicted.
- **A field cannot say what a command does with one argument.** A field
  covers a command, not a call, so it stays `true` for a call that asks for
  what is already there: `setBlockType("paragraph")` in a paragraph, a
  table setter with the column's own value, `setBlockAlignment(null)`
  outside a `:::` block. Since round 3 such a call changes nothing at all,
  no undo step included, and the docs list them.
- **The toolbar's Link button is narrower than `canLink`** for a selection
  holding an image and no text: `toggleLink` would wrap the image, but the
  button also asks for `hasSelectedText` or an enclosing link, as it did
  before `canLink` covered that case. The context menu's Insert link… is
  dimmed there for the same reason.

### Left as it is

- The `$editWritably` refusals are not foreseen by the record: a format,
  style or link the save could not write as shown is still declined when
  tried, with its item enabled, as the plan's non-goals say.
