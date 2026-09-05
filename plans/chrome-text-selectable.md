# Selectable Chrome Text — Implementation Plan

## Overview

Most text this framework renders cannot be selected with the mouse: every `Component` inherits `userSelect: "none"` from [`ComponentDefaults.ts:25`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L25). Read-only content opts out of that default by using [`SelectableText`](packages/lib/src/typescript/lib/component/input/SelectableText.ts#L34) instead of `Text` — a `Text` subclass whose class defaults are `userSelect: "text"` and `cursor: "text"` ([`SelectableText.ts:19-22`](packages/lib/src/typescript/lib/component/input/SelectableText.ts#L19-L22)). Rendered Markdown, table cell values, `Dialog` messages and both `Notification` messages are all selectable today — most of them through `SelectableText` itself, `Markdown` and `Link` through the same kind of class-defaults bag.

Two read-only surfaces still build a plain `Text` and are therefore unselectable: the status bar's message ([`StatusBar.ts:128`](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L128)) and the two built-in tree node labels ([`tree/renderer/Label.ts:39`](packages/lib/src/typescript/lib/component/tree/renderer/Label.ts#L39), [`tree/renderer/IconLabel.ts:79`](packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts#L79)). This plan swaps those three `new Text(...)` calls for `new SelectableText(...)`, and adds one opt-out at [`MarkdownMinimap.ts:197-201`](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L197-L201), whose outline entries share the tree label renderer but are navigation chrome.

Copying stays entirely the browser's: Ctrl/Cmd+C, or the OS right-click menu offered on a live selection. Nothing here is editable, so this plan adds no context menu, no Cut and no Paste.

Two further candidates were investigated and are deliberately left out — `Tooltip`'s text and `LabelListItemRenderer`'s label. Both have their own decision below.

---

## Architecture Decisions

### The three sites swap `Text` for `SelectableText`

Each site changes only the class it constructs: `new Text(...)` becomes `new SelectableText(...)`. Each field keeps its declared type `Text`, and each accessor (`getLabel(): Text`) keeps its signature.[^declared-type]

The precedent is [`plans/implemented/style-rule-materialization-reduction.md`](implemented/style-rule-materialization-reduction.md), which created `SelectableText` and converted nine `Text` children to it in exactly this shape — `Notification._messageText` ([`Notification.ts:208`](packages/lib/src/typescript/lib/overlay/Notification.ts#L208)), `Dialog`'s `messageText` ([`Dialog.ts:741`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L741)), and the cell renderers' inner labels. No imperative `setUserSelect("text")` call is added anywhere.[^same-mechanism]

### Only the element the pointer lands on has to change

A text selection can only start in an element whose own `user-select` allows it. Each surface was checked in the running app to find which element the pointer actually hits, and only that element needs to become a `SelectableText`:

| Surface | Element the pointer hits | Element that becomes `SelectableText` | Ancestors changed |
|---|---|---|---|
| Status bar message | the message `Text` itself | that `Text` | none |
| Tree node label (both renderers) | the label `Text` itself | that `Text` | none — the row and the renderer stay `user-select: none` |
| Table cell value (already shipped) | the `CellRenderer`, because its `Text` is `pointer-events: none` | the `Text` **and** the renderer | the renderer |

The table row is the case that needed two opt-ins; neither surface in this plan does.[^pointer-target-evidence]

### A status-bar message is a message, not chrome

`StatusBar`'s message carries application content — a row count, an error string, a file path, the coordinates of a clicked cell. It is the same category as a `Notification` toast message and a `Dialog` body message, both of which are `SelectableText` today.[^status-message-category]

### A tree node label is the tree's data

`LabelTreeNodeRenderer` and `IconLabelTreeNodeRenderer` render `context.node.label` — the caller's own data, the same kind of value a table cell holds. Both become selectable; the icon `Glyph` in `IconLabelTreeNodeRenderer` does not.[^tree-label-data]

### `MarkdownMinimap` opts its labels back out

[`MarkdownMinimap`](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L197) builds its outline from `LabelTreeNodeRenderer`, so the swap above would reach it too. Its renderer factory restates `userSelect: "none"` and `cursor: "default"` on the label, mirroring the shape [`GroupSeparatorCell`](packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts#L37-L39) already uses to opt a shared renderer back out.[^minimap-optout]

### The text cursor comes with the selection, by design

`SelectableText` sets `cursor: "text"` alongside `userSelect: "text"`, so both new surfaces show an I-beam on hover. That pairing is deliberate and is not split here.[^cursor-comes-along]

### `Tooltip` is not included — its text cannot be reached by a pointer

[`Tooltip`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L165) sets `pointerEvents: "none"` on its own root and again on its inner `Text` ([`Tooltip.ts:171`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L171)), so the pointer passes straight through a visible tooltip. On top of that, `Tooltip.attach` dismisses on the anchor's `mouseout` ([`Tooltip.ts:422-423`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L422-L423)). A `SelectableText` there would be dead code.[^tooltip-unreachable]

### `LabelListItemRenderer` is not included — three separate things block it

A list row is not selectable for three independent reasons, and none of them is a `user-select` value: [`SelectableListRow`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L371) sets `pointerEvents: "none"` on its whole renderer, so the label is never the pointer target; the row itself is covered by a `.List, .MultiSelectList { user-select: none }` rule ([`AbstractSelectableList.ts:202`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L202)); and the row registers `pointerdown` with `{ prevent: true }` ([`AbstractSelectableList.ts:390`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L390)) to stop the list root losing focus, which by itself kills the browser's drag-select gesture. The same renderer is also `ComboBox`'s collapsed control label ([`ComboBox.ts:731`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L731)), which is chrome.[^list-blocked]

---

## Ordered Implementation Steps

No new API is added. Every step either changes which class a `new` expression constructs, or restates a value through setters that already exist.

1. **[`packages/lib/src/typescript/lib/component/tree/renderer/Label.ts`](packages/lib/src/typescript/lib/component/tree/renderer/Label.ts)** — add `import { SelectableText } from "~/component/input/SelectableText.js";` after the existing `Text` import at line 5 (keep that import: the `_label` field at line 29 and `getLabel()` at line 50 stay typed `Text`). Change line 39 from `this._label = new Text(undefined, { truncate: true });` to `this._label = new SelectableText(undefined, { truncate: true });`. Extend the class `@remarks` block (lines 15-19) with one sentence: the label is a `SelectableText`, so a node label can be selected and copied, and a custom `TreeNodeRenderer` gets that only by using `SelectableText` for its own text.
   *Check:* `grep -n 'new Text(' packages/lib/src/typescript/lib/component/tree/renderer/Label.ts` — zero matches.

2. **[`packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts`](packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts)** — add the same import after the `Text` import at line 6. Change line 79 from `this._label         = new Text();` to `this._label         = new SelectableText();`, keeping the existing column alignment. Leave `this._icon` and every `Glyph` line alone — an icon is not text and stays unselectable.
   *Check:* `grep -n 'new Text(' packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts` — zero matches.

3. **[`packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts`](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L197)** — inside the renderer factory, immediately after `renderer.getLabel().setFontSize(ROW_FONT_SIZE);` at line 199, add:
   ```typescript
   // An outline entry is navigation chrome, not content: it is clicked to
   // jump, never read for its own sake. LabelTreeNodeRenderer's label is a
   // SelectableText, so restate both values here — the same opt-out
   // GroupSeparatorCell makes against the shared StringRenderer.
   renderer.getLabel().setUserSelect("none");
   renderer.getLabel().setCursor("default");
   ```
   *Check:* `grep -n 'setUserSelect\|setCursor' packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts` — exactly two matches, both inside the factory.

4. **[`packages/lib/src/typescript/lib/component/container/StatusBar.ts`](packages/lib/src/typescript/lib/component/container/StatusBar.ts)** — add `import { SelectableText } from "~/component/input/SelectableText.js";` after the `Text` import at line 5 (keep that import: `_messageText` at line 108 stays typed `Text`). Change line 128 from `this._messageText = new Text("");` to `this._messageText = new SelectableText("");`. Leave the `centerInHeight` call at line 138 and its long comment untouched — the line-box anchoring it describes is unchanged. Add one sentence to the class JSDoc (the paragraph at lines 72-83): the message text can be selected and copied, while the widgets around it stay chrome.
   *Check:* `grep -n 'new Text(' packages/lib/src/typescript/lib/component/container/StatusBar.ts` — zero matches.

5. **Create [`packages/lib/tests/component/tree/renderer/TreeLabelSelection.test.ts`](packages/lib/tests/component/tree/renderer/TreeLabelSelection.test.ts)** — the tree-side cases from `## Expected Behaviour`. Copy the harness setup from the sibling [`Label.test.ts`](packages/lib/tests/component/tree/renderer/Label.test.ts) exactly: the same `CONFIG` object, `installTestDOM(CONFIG)` per test, `afterEach(() => DOM.reset())`, and the same `../../../dom/TestDOM` import depth. Model the file's shape on [`CellTextSelection.test.ts`](packages/lib/tests/component/table/CellTextSelection.test.ts), which pairs each opt-in with the matching opt-out in one file. Four component imports are needed beyond the harness: `LabelTreeNodeRenderer` from `~/component/tree/renderer/Label`, `IconLabelTreeNodeRenderer` from `~/component/tree/renderer/IconLabel`, `LabelListItemRenderer` from `~/component/list/renderer/Label`, and `MarkdownMinimap` from `~/component/display/MarkdownMinimap`.

6. **[`packages/lib/tests/component/container/StatusBar.test.ts`](packages/lib/tests/component/container/StatusBar.test.ts)** — add the status-bar case from `## Expected Behaviour`. Reach the message the way line 243 already does: `bar.getComponents()[0] as Text`.

7. **Docs prose** — apply the three edits listed in `## Documentation Impact` to [`StatusBar.md`](packages/lib/docs/components/StatusBar.md), [`Tree.md`](packages/lib/docs/components/Tree.md) and [`MarkdownMinimap.md`](packages/lib/docs/components/MarkdownMinimap.md).

8. **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — add one bullet under the existing `## Changed` → `### Components` heading (line 31), describing the behaviour rather than the CSS.

9. **Run everything in `## Verification`**, including the browser checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/tree/renderer/Label.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/StatusBar.ts` |
| Create | `packages/lib/tests/component/tree/renderer/TreeLabelSelection.test.ts` |
| Modify | `packages/lib/tests/component/container/StatusBar.test.ts` |
| Modify | `packages/lib/docs/components/StatusBar.md` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/components/MarkdownMinimap.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable

`getUserSelect()` and `getCursor()` fold the class defaults bag and need no DOM, so every row below runs on the offline harness. The harness is still installed because the renderers mint elements at construction.

| Case | Expectation |
|---|---|
| `new LabelTreeNodeRenderer().getLabel().getUserSelect()` | `"text"` |
| `new LabelTreeNodeRenderer().getLabel().getCursor()` | `"text"` |
| `new LabelTreeNodeRenderer().getUserSelect()` | `"none"` — the renderer root is not the pointer target and gets no opt-in |
| `new LabelTreeNodeRenderer().getLabel().getTextOverflow()` | `"ellipsis"` — the `{ truncate: true }` option survived the constructor swap |
| `new IconLabelTreeNodeRenderer().getLabel().getUserSelect()` | `"text"` |
| `new IconLabelTreeNodeRenderer().getLabel().getCursor()` | `"text"` |
| `new LabelListItemRenderer().getLabel().getUserSelect()` | `"none"` — the list label is deliberately unchanged |
| The minimap's label, reached as `(minimap as unknown as { _tree: { getRendererFactory(): () => LabelTreeNodeRenderer } })._tree.getRendererFactory()().getLabel()`, for `const minimap = new MarkdownMinimap()` | `getUserSelect()` is `"none"` and `getCursor()` is `"default"` |
| `(bar.getComponents()[0] as Text).getUserSelect()` for `const bar = new StatusBar()` | `"text"` |
| `(bar.getComponents()[0] as Text).getCursor()` | `"text"` |
| `bar.getComponents()[0] instanceof Text` | `true` — the swap keeps the message a `Text`, so the bar's baseline maths is unaffected |

Rows 1-8 go in the new `TreeLabelSelection.test.ts`; rows 9-11 go in the existing `StatusBar.test.ts`. The private-field cast in the minimap row follows the pattern [`Notification.test.ts`](packages/lib/tests/overlay/Notification.test.ts) already uses to reach a private message `Text`.

`Tooltip` gets no unit case: its constructor is private and `_text` is unreachable. It is covered by the manual table.

### Manual verification only

The offline harness records `dispatchEvent` without invoking listeners and returns `[]` from `elementsFromPoint`, so no selection gesture can be driven in a test. Run the demo app with `npm run dev` and visit `http://localhost:8015`:

| Case | Expectation |
|---|---|
| `#/content-box`, the tree row — drag across two node labels | Both labels highlight; Ctrl/Cmd+C copies the highlighted text |
| `#/content-box` — double-click a node label | The word under the cursor highlights, and the row behaves exactly as before (select / expand) |
| `#/content-box` — single-click a node label | The row selects; nothing highlights |
| `#/content-box` — hover a node label | I-beam cursor |
| `#/content-box` — start a drag on an `IconLabelTreeNodeRenderer` row's **icon** | Nothing highlights; the icon is not text |
| `#/misc` → "Show window with table (column spec)!" — drag across the status bar message | The message highlights; Ctrl/Cmd+C copies it |
| Same window — click a data cell, then drag across the new `clicked … = …` message | The replaced message is selectable too |
| Same window — hover the status bar message | I-beam cursor |
| `#/misc` — hover "Hover over me for a tooltip", then try to drag across the tooltip | The tooltip does not highlight and dismisses on mouse-out, exactly as today |
| `#/misc` — drag across the list rows under "Item renderers (glyph per entry)" | Nothing highlights, exactly as today |
| `#/misc` — drag across any button label, tab title or menu item | Nothing highlights, exactly as today |
| Docs app (`npm run build:lib`, then `npm run docs:dev`, `http://localhost:5173`) — drag across an entry in the floating outline minimap | Nothing highlights; hovering shows the plain arrow |

The docs app resolves `@jimka/typescript-ui` through the workspace package's build output, so the `build:lib` step is required before the minimap row can be checked.

### Accepted side effects

- Dragging across two tree labels leaves a text selection but does **not** change the tree's row selection: `Tree`'s click handling is a subtree `click` listener ([`Tree.ts:1482`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1482)) that matches a row by containment, and a cross-row drag delivers its `click` on the rows' common ancestor, which is inside no row.
- A drag that starts on an `IconLabelTreeNodeRenderer` row's icon selects nothing, because the `Glyph` is the element under the pointer there and it keeps `user-select: none`.
- The tree label and the status message now render with a `.SelectableText` class rule instead of a `.Text` one, so their line-height value classes become `.SelectableText.lh…` rather than `.Text.lh…`. This is a rule-naming change only; no declaration is added or lost.

---

## Verification

1. `cd packages/lib && npm run typecheck` — clean.
2. `cd packages/lib && npx vitest run --no-file-parallelism` — `Errors: 0`. Pay attention to `tests/component/tree/`, `tests/component/container/StatusBar.test.ts` and `tests/component/display/MarkdownMinimap.test.ts`.
3. `cd packages/lib && npm run lint` — clean. No raw DOM access is introduced; every write goes through an existing `Component` setter or a constructor.
4. `cd packages/lib && npm run docs:api` — zero warnings.
5. Greps that pin the scope:
   - `grep -rn 'new SelectableText' packages/lib/src/typescript/lib/component/tree/ packages/lib/src/typescript/lib/component/container/StatusBar.ts` — exactly three matches: `renderer/Label.ts`, `renderer/IconLabel.ts`, `StatusBar.ts`.
   - `grep -rn 'SelectableText' packages/lib/src/typescript/lib/component/list/` — zero matches.
   - `grep -rn 'SelectableText' packages/lib/src/typescript/lib/overlay/Tooltip.ts` — zero matches.
   - `grep -n 'setUserSelect\|setCursor' packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts` — exactly two matches.
6. Walk the manual table above in the running app, and the last row in the docs app.

---

## Documentation Impact

No exported symbol, option or signature changes — `SelectableText` is already exported from [`component/input/index.ts:5`](packages/lib/src/typescript/lib/component/input/index.ts#L5) and already has an API page, and every touched field keeps its declared `Text` type. No catalog or sidebar entry moves. Three prose pages plus the changelog need a line:

- [`packages/lib/docs/components/StatusBar.md`](packages/lib/docs/components/StatusBar.md) — the opening paragraph (line 3) calls the component "chrome-only". Keep that framing for the strip, and add that the message text itself can be selected and copied, so a reader can lift an error string or a count out of the bar.
- [`packages/lib/docs/components/Tree.md`](packages/lib/docs/components/Tree.md) — in the renderer table's section (lines 144-145), state that both built-in renderers make the node label selectable and copyable, and that a custom `TreeNodeRenderer` gets the same only by building its text as a `SelectableText`.
- [`packages/lib/docs/components/MarkdownMinimap.md`](packages/lib/docs/components/MarkdownMinimap.md) — one sentence: outline entries are navigation targets and stay unselectable, unlike a plain `Tree`'s labels.
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — under `## Changed` → `### Components`: a status bar's message and a tree node's label can now be selected with the mouse and copied with Ctrl/Cmd+C; the `MarkdownMinimap` outline, list rows, tooltips, buttons, tabs and menu items still cannot.

---

## Potential Challenges

- **The minimap opt-out is easy to miss.** Without step 3, every docs-site outline entry silently becomes selectable, contradicting an explicit earlier decision. Step 3's grep and the minimap unit row both catch it.
- **`IconLabelTreeNodeRenderer` has no existing test file.** Its cases live in the new `TreeLabelSelection.test.ts` rather than a file of its own; do not create a second file for them.
- **`new Text(undefined, { truncate: true })` must keep its options argument.** Dropping the second argument while changing the class would silently turn off ellipsis truncation for every tree label. The `getTextOverflow()` unit row is there to catch exactly that — `setTruncate(true)` is what sets `text-overflow: ellipsis`, so the getter returns `null` if the option was lost.
- **`StatusBar`'s message `Text` is the bar's baseline anchor.** `SelectableText` extends `Text` and adds only `userSelect`/`cursor` class defaults, so `centerInHeight`, the 21px line box and the resulting `rowAscent` are unchanged — but the existing baseline tests in `StatusBar.test.ts` are the check that this held, and must stay green untouched.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/input/SelectableText.ts`](packages/lib/src/typescript/lib/component/input/SelectableText.ts) — the mechanism this plan reuses, and the JSDoc that draws the content-versus-chrome line.
- [`plans/implemented/style-rule-materialization-reduction.md`](implemented/style-rule-materialization-reduction.md) — **the precedent**: it created `SelectableText` and converted nine `Text` children to it in the exact shape steps 1, 2 and 4 follow.
- [`plans/implemented/selectable-display-text.md`](implemented/selectable-display-text.md) — the original feature and the source of the `MarkdownMinimap` "navigation chrome" decision this plan honours.
- [`plans/implemented/selectable-text-cursor.md`](implemented/selectable-text-cursor.md) — why a selectable surface must also carry the text cursor, and why an unselectable one must not.
- [`packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts`](packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts#L37-L39) — the opt-out shape step 3 copies.
- [`packages/lib/src/typescript/lib/component/tree/TreeRow.ts`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L77) — the row that owns each renderer. Read it to confirm it sets no `pointerEvents` on the renderer, which is why the label is the pointer target.
- [`packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L371) — the three blockers behind the list decision (lines 202, 371, 390). Read, not modified.
- [`packages/lib/src/typescript/lib/overlay/Tooltip.ts`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L165) — the two `pointerEvents: "none"` writes behind the tooltip decision. Read, not modified.
- [`packages/lib/tests/component/table/CellTextSelection.test.ts`](packages/lib/tests/component/table/CellTextSelection.test.ts) — the model for the new test file's shape.
- [`packages/lib/tests/component/tree/renderer/Label.test.ts`](packages/lib/tests/component/tree/renderer/Label.test.ts) — the harness setup the new test file copies verbatim.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the class-tier cascade that makes a `SelectableText`'s defaults land on a shared `.SelectableText` rule rather than each instance's `#id` rule.

---

## Non-Goals

- **`Tooltip` stays unselectable.** Its root and its text are both `pointer-events: none`, and it dismisses on the anchor's `mouseout`; a selection cannot start there whatever the CSS says.
- **`LabelListItemRenderer` and list rows stay unselectable.** Making them selectable would mean weakening the `pointerdown` focus guard, dropping the renderer's `pointer-events: none`, and changing the `.List, .MultiSelectList` rule — and it would also make `ComboBox`'s collapsed control label selectable.
- **`MarkdownMinimap` entries stay unselectable**, keeping the decision `selectable-display-text.md` already made about them.
- **The `Glyph` in `IconLabelTreeNodeRenderer` is untouched.** An icon is not text.
- **No context menu, no Cut, no Paste.** Both surfaces are read-only; copying is the browser's own Ctrl/Cmd+C and OS selection menu.
- **No new API.** No option, setter, getter or component is added; `SelectableText` already exists and is already exported.
- **A consumer's own `TreeNodeRenderer` is not converted.** It opts in the same way the built-ins do, by building its text as a `SelectableText`; `Tree.md` documents that.
- **`Text`'s own default does not change.** Flipping it would make every button label, tab title and menu item selectable.

---

## Notes

[^same-mechanism]: Two alternatives were rejected. Calling `this._label.setUserSelect("text")` imperatively is what `selectable-display-text.md` originally did, and `style-rule-materialization-reduction.md` deliberately replaced those calls with `SelectableText` at nine of the ten sites — the per-instance call writes the declaration into each instance's `#id` CSS rule, while the class default lands once on a shared `.SelectableText` rule. Reintroducing the imperative form at three new sites would walk that back. Giving `Text` itself a selectable default was rejected in that same plan and stays rejected here: `Text` is the framework's general-purpose text component, used for button labels and menu titles, and `CellTextSelection.test.ts` asserts those stay unselectable.

[^pointer-target-evidence]: Checked in the running app at `http://localhost:8015`. For a tree row, `document.elementFromPoint` over a node label returns the label's own element (`class="ts-ui-component Text lh16px"`), and both the renderer and the label compute `pointer-events: auto` — `TreeRow` sets no `pointerEvents` on its renderer, unlike `SelectableListRow`, which does. Injecting `user-select: text` on the label alone and then driving a real mouse drag from one label to another produced the selection `"nent.tsEven"` (mid-`Component.ts` to mid-`Event.ts`), with the row and renderer left at `user-select: none`; removing the injection and repeating the identical drag produced an empty selection. A real double-click on a label with the injection in place selected the word `"Component"`, so `Tree._handleDblClick`'s `{ prevent: true }` return does not suppress word selection — it fires after the second `mousedown` has already made it. For the status bar, `elementFromPoint` over the message likewise returns the message `Text` itself, and the same injected-then-removed drag pair produced `"vg Score 72.2 · max 95 · active 4, i"` and then nothing.

[^status-message-category]: `SelectableText`'s own class doc names "a dialog or notification message" as the canonical selectable case, and both of those are `SelectableText` today. A status message is the same kind of value: the demo app's own status bar shows `6 rows · avg Score 72.2 · max 95 · active 4, inactive 2` and, on a cell click, `clicked Score = 95 (row 0, col 2)` ([`MiscPanel.ts:806-816`](packages/lib/src/typescript/MiscPanel.ts#L806-L816)) — counts, field names and values a reader has a plain reason to copy. `StatusBar.md`'s opening line calls the component "chrome-only", which is true of the strip and its widgets; the message string it carries is application content, and step 7 adjusts that sentence rather than contradicting it. Nothing in the bar is interactive on the message itself: `StatusBar` registers no pointer listeners at all, so there is no gesture for a drag-select to collide with.

[^tree-label-data]: The dividing line the earlier plans drew is data versus chrome, not interactive versus static — a table cell value is selectable even though clicking its row selects the row. A tree node label is the same shape of thing: `context.node.label` is the caller's data, typically a file name, a schema object name or a heading. Making a file name selectable in a `Table` but not in a `Tree` would be an inconsistency inside one framework. The counter-argument — that native desktop trees (Explorer, Finder, an IDE file sidebar) are not text-selectable — applies equally to native tables, and this framework already decided the other way there. Live checking also showed the cost is nil: a cross-row drag paints a selection without changing the tree's row selection, and single-click and double-click both keep working.

[^minimap-optout]: `selectable-display-text.md`'s `## Non-Goals` says "**`MarkdownMinimap` is untouched.** It is built on `Tree`, not `Markdown`, and its entries are navigation chrome." That decision is honoured rather than silently reversed. The opt-out is cheap because `MarkdownMinimap` already customises its renderer in a three-line factory ([`MarkdownMinimap.ts:197-201`](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L197-L201)), so two more lines sit naturally beside the existing `setFontSize` call. A dedicated `Text` subclass — the route `HeaderCellText` ([`Header.ts:105`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L105)) took for the same problem on table headers — was rejected as disproportionate: a minimap holds a couple of dozen rows, so the per-instance declarations those two setters produce cost almost nothing, and `GroupSeparatorCell` still uses the plain per-instance form for exactly this case.

[^cursor-comes-along]: `selectable-text-cursor.md` established that the hover cursor must mirror selectability in both directions: selectable content shows an I-beam so the affordance is visible, and unselectable content must not, because "a cursor promising an affordance the element does not have" is the failure mode that plan exists to prevent. Using `SelectableText` gets both values from one class default, which is why the `MarkdownMinimap` opt-out has to restate both — `setUserSelect("none")` alone would leave outline entries showing an I-beam over text that cannot be selected.

[^tooltip-unreachable]: Verified in the running app. With a tooltip visible (`visibility: visible`, `opacity: 1`), `document.elementFromPoint` at the tooltip's own centre returns a different element underneath it, not the tooltip — both the root and the inner `Text` compute `pointer-events: none`. Because no pointer event ever lands on the tooltip, no selection can start in it, and no drag can extend into it either. The dismissal behaviour reinforces this: `Tooltip.attach` wires `mouseout` on the anchor straight to `Tooltip.hide()`, so moving the pointer off the anchor toward the tooltip dismisses it before a drag could finish. Both earlier plans in this family already listed tooltip text as a Non-Goal; this evidence is why that stays the right call rather than an unexamined carry-over.

[^list-blocked]: The `pointerdown` guard was checked directly in the running app, because it is the least obvious of the three blockers. Two structurally identical `<div>`s were built with `user-select: text`, differing only in that one had a `pointerdown` listener calling `preventDefault()`. A real mouse drag across the plain one selected `"WORD mmmm mmmm mmmm RIGHT"`; the identical drag across the prevented one, with the selection cleared first, produced an empty string; re-running the plain drag afterwards selected text again. `SelectableListRow` registers its `pointerdown` that way to stop the list root blurring when a row is pressed, so removing it to enable selection would trade a working focus model for a copy affordance. On top of that, the row — not the label — is the element the pointer hits, since the whole renderer is `pointer-events: none`, so the fix would also have to move `user-select` onto the row and past the `.List, .MultiSelectList` rule. Three coordinated changes to a focus-sensitive surface is a different plan from the one-line swaps here, and `ComboBox` reusing the same renderer for its collapsed control label means the result would also reach a form control.

[^declared-type]: `SelectableText extends Text`, so `_label: Text`, `_messageText: Text` and `getLabel(): Text` all keep working with no signature change, and `instanceof Text` still holds. That matters beyond typing: `CellRenderer.doLayout` and the tree renderers' own `layoutChildren` reach their child as a `Text`, and `StatusBar`'s baseline row treats the message as one. `style-rule-materialization-reduction.md` made the same choice for all nine of its conversions — "Every converted site keeps its declared type as `Text`, changing only the constructed class."
