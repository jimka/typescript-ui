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
