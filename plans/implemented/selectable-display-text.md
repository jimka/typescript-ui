---
touches-shared:
  - packages/lib/src/typescript/lib/overlay/DragManager.ts
---

# Selectable Display Text — Implementation Plan

## Overview

Almost nothing rendered by this framework can be selected or copied with the mouse — native text inputs and the two `contenteditable` editor surfaces are the only exceptions. Every `Component` writes `user-select: none` onto its own element — the value is seeded in the constructor at [`Component.ts:541`](packages/lib/src/typescript/lib/core/Component.ts#L541), flushed into the element's rule at [`Component.ts:4860`](packages/lib/src/typescript/lib/core/Component.ts#L4860), and repeated in the framework-wide class rule at [`ClassStyleRules.ts:44`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L44). A public [`setUserSelect`](packages/lib/src/typescript/lib/core/Component.ts#L4525) exists, and exactly one call site uses it — [`Scrollbar.ts:383`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L383), which restates the `"none"` default.

This plan turns on selection for five read-only, user-facing surfaces, each opting in at its own construction site: the [`Markdown`](packages/lib/src/typescript/lib/component/display/Markdown.ts) viewer, table cell values, the [`Dialog`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L629) message, the [`Notification`](packages/lib/src/typescript/lib/overlay/Notification.ts#L195) toast message, and the notification [detail dialog's](packages/lib/src/typescript/lib/overlay/Notification.ts#L510) message. Interactive chrome keeps its current behaviour.

Selectable table cells introduce one gesture conflict, so this plan also changes [`DragManager`](packages/lib/src/typescript/lib/overlay/DragManager.ts#L491): while a drag press is live, the browser's own text-selection gesture is suppressed through the listener's return value.

---

## Architecture Decisions

### Each surface opts in at its own construction site

Every surface calls `this.setUserSelect("text")` (or calls it on the child it owns) in its own constructor. No shared default changes, and `Text` keeps its inherited `"none"`.[^why-per-site]

The precedent is [`Scrollbar.ts:383`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L383), which states `setUserSelect("none")` locally even though that is already the inherited value. Three shared class rules do the same thing through a module-level `StyleRule` — [`ComboBox.ts:334`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L334), [`CollapseButton.ts:125`](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L125), [`AbstractSelectableList.ts:187`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L187). The established shape is an explicit, local statement of the value, not reliance on inheritance.

### The element the pointer lands on is the one that must opt in

`user-select: none` on the element under the cursor stops a selection from *starting* there. Because every `Component` element carries that declaration in its own right, an opt-in on a container does not reach a `Component` child — the child's own declaration wins over the inherited value. So each surface must opt in on the element the pointer hits, **and** on any `Component` that holds the text itself.[^cascade-evidence]

| Surface | Element the pointer hits | Elements that get `user-select: text` |
|---|---|---|
| `Markdown` prose | the `Markdown` root (its content is raw DOM, not `Component`s) | the `Markdown` root only |
| `Dialog` / `Notification` message | the `Text` itself (`pointer-events` is unset, so it is hit normally) | that `Text` only |
| Table cell value | the `CellRenderer` (its `Text` child is `pointer-events: none`) | the `CellRenderer` **and** its `Text` child |

The table row is the case that needs both: the renderer must allow the selection to start, and the `Text` must allow its own content to be included.

### Table cell text keeps `pointer-events: none`

The `Text` inside each cell renderer stays `pointer-events: none`, exactly as today. Nothing about pointer routing changes, so row-click selection ([`Body.ts:816`](packages/lib/src/typescript/lib/component/table/Body.ts#L816)) and double-click-to-edit ([`Cell.ts:89`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L89)) keep resolving to the same targets they do now.[^pointer-events-kept]

### Header, parent-header and group-separator cells opt back out

[`HeaderCell`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L83), [`ParentHeaderCell`](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L30) and [`GroupSeparatorCell`](packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts#L18) all extend `DefaultCell`, so they inherit the `StringRenderer` opt-in. Each restates `"none"` on its own renderer and that renderer's `Text`.[^why-opt-out]

### A live drag suppresses the browser's parallel text selection

Every [`TreeTable`](packages/lib/src/typescript/lib/component/table/TreeTable.ts#L140) row is registered as a `DragManager` drag source, and that gesture is mouse-driven: a `mousedown` arms it and `mousemove` drives it. Once cell text is selectable, dragging across rows paints a text selection on top of the row-reparent drag.[^drag-conflict-evidence]

`DragManager.onMouseMove` already returns a disposition on every exit; those returns become `{ stop: true, prevent: true }`, which adds `preventDefault()` and stops the selection from growing. The drag source's `mousedown` is deliberately left alone.[^why-not-mousedown]

### `WysiwygSurface` and `CodeEditor` are already selectable — only a comment changes

Both are `contenteditable` regions, which the browser exempts from `user-select: none`, and Lexical additionally writes `user-select: text` inline on its root. Both were checked in the running app and both select and copy today.[^editing-hosts]

`WysiwygSurface` gains one line — `this.setUserSelect("text")` — so the framework's own rule states the intent instead of leaning entirely on a third-party inline write, and the comment at [`MarkdownEditor.ts:170-174`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L170-L174) is corrected to name the real mechanism. `CodeEditor` needs no change at all.

---

## Ordered Implementation Steps

Steps 1-10 all write `setUserSelect(...)`, a method that already exists on `Component`. No new API is added anywhere in this plan.

1. **[`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts)** — in the constructor, directly after `this.setWhiteSpace("normal")` at line 599, add `this.setUserSelect("text");` with a short comment saying that rendered prose is read-only content the reader copies, and that `Markdown`'s children are raw DOM nodes so they inherit the value.
   *Check:* `grep -n 'setUserSelect' packages/lib/src/typescript/lib/component/display/Markdown.ts` — one match.

2. **[`packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts`](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts)** — in the constructor, add `this.setUserSelect("text");` and `this._text.setUserSelect("text");` next to the existing `this._text.setPointerEvents("none");` at line 26. Comment once here (this is the renderer every other one mirrors) that the renderer is the element the pointer hits, so it must allow the selection to start, while the `Text` needs its own opt-in because its element carries the framework's `user-select: none` in its own right.

3. Repeat step 2's two lines in the remaining six text-bearing renderers, without repeating the long comment:
   - [`Number.ts:33`](packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts#L33)
   - [`Date.ts:25`](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L25)
   - [`DateTime.ts:27`](packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L27)
   - [`Time.ts:28`](packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L28)
   - [`Combo.ts:42`](packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts#L42)
   - [`Link.ts:70`](packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts#L70) — this one has no `setPointerEvents` line; put the two calls next to `this._text.setAutoMeasure(false);`.

   *Check:* `grep -rn 'setUserSelect' packages/lib/src/typescript/lib/component/table/cell/renderer/` — two code lines per file across seven files (a comment naming the method matches too, so count code, not raw hits). `GlyphRenderer`, `FilterCellRenderer` and `TreeCellRenderer` are **not** in this list and must stay untouched.

4. **[`packages/lib/src/typescript/lib/component/table/cell/Header.ts`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L114)** — in the `HeaderCell` constructor, after the `renderer.getText().setText(text);` line at 117, add `renderer.setUserSelect("none");` and `renderer.getText().setUserSelect("none");`, with a comment that a column title is chrome, not data, so it stays unselectable even though `StringRenderer` now opts in.

5. **[`packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts`](packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L54)** — same two lines in the `ParentHeaderCell` constructor, after line 58.

6. **[`packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts`](packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts#L34)** — same two lines in the `GroupSeparatorCell` constructor, after line 36.

   *Check:* `grep -rn 'setUserSelect' packages/lib/src/typescript/lib/component/table/cell/*.ts` — 6 matches across exactly these three files.

7. **[`packages/lib/src/typescript/lib/overlay/DragManager.ts`](packages/lib/src/typescript/lib/overlay/DragManager.ts#L491)** — in `onMouseMove`, replace **every** `return true;` with `return { stop: true, prevent: true };` (six sites: lines 503, 511, 535, 542, 562, 574). Leave the bare `return;` in the `activeSession === null` guard alone, and leave `onMouseUp` alone. Add a comment at the first replaced site explaining that `prevent` suppresses the browser's own text-selection gesture, which would otherwise run alongside the drag now that table cell text is selectable.
   *Check:* `grep -n 'return true;' packages/lib/src/typescript/lib/overlay/DragManager.ts` — one match left, in `onMouseUp`.

8. **[`packages/lib/src/typescript/lib/overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L629)** — after `messageText.setPadding(...)`, add `messageText.setUserSelect("text");`.

9. **[`packages/lib/src/typescript/lib/overlay/Notification.ts`](packages/lib/src/typescript/lib/overlay/Notification.ts#L195)** — add `this._messageText.setUserSelect("text");` to the constructor, and `content.setUserSelect("text");` in `showDetail` after `content.setPadding(...)` at line 514. Both are needed: the toast clamps its message to two lines, so the detail dialog is where a long message is actually read and copied.

10. **[`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L170)** — in the `WysiwygSurface` constructor, add `this.setUserSelect("text");` next to `this.setCursor("text")` at line 175, and rewrite the comment at lines 170-174. The corrected comment must say three things: the surface is a `contenteditable` editing host, which the browser exempts from `user-select: none`; Lexical additionally writes `user-select: text` inline on the root when it mounts; and the explicit `setUserSelect("text")` states the same intent in the framework's own rule, so the behaviour does not depend on an inline write surviving a later re-render.

11. **Docs pages** — apply the three prose edits listed in `## Documentation Impact` to [`Markdown.md`](packages/lib/docs/components/Markdown.md), [`Table.md`](packages/lib/docs/components/Table.md) and [`custom-cell.md`](packages/lib/docs/recipes/custom-cell.md).

12. **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — add entries under `## Changed`, in the existing per-area subsections (`### Core` or a new `### Display`, plus `### Table`). Describe the behaviour, not the CSS: rendered Markdown prose, table cell values, dialog messages and notification messages can now be selected and copied; table headers, buttons, tabs and menu items still cannot.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Number.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Combo.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/Link.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/GroupSeparator.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/DragManager.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `packages/lib/tests/component/table/CellTextSelection.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/recipes/custom-cell.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable

These read cached state through `getUserSelect()`, so they run on the offline harness with no DOM. Only `StringRenderer`, `ComboRenderer` and `LinkCellRenderer` expose a `getText()`; for the other four, reach the `Text` as `renderer.getComponents()[0]`, its single child.

| Case | Expectation |
|---|---|
| `new Markdown("# Hi").getUserSelect()` | `"text"` |
| `new StringRenderer().getUserSelect()` | `"text"` |
| `new StringRenderer().getComponents()[0].getUserSelect()` | `"text"` |
| The same two reads on `NumberRenderer`, `DateRenderer`, `DateTimeRenderer`, `TimeRenderer`, `ComboRenderer`, `LinkCellRenderer` | `"text"` |
| `new GlyphRenderer().getUserSelect()` | `"none"` — glyph cells are not text |
| `new HeaderCell("Name", "name").getRenderer().getUserSelect()` and `…getRenderer().getText().getUserSelect()` | `"none"` |
| `new ParentHeaderCell("Group", null)` — the same two reads | `"none"` |
| `new GroupSeparatorCell("Group", null)` — the same two reads | `"none"` |
| `new StringCell().getRenderer().getUserSelect()` | `"text"` — a body cell built from the same renderer is unaffected by the header opt-outs |
| `dialog.getContentComponent().getComponents()[0].getUserSelect()` for a `Dialog` built with a `message` | `"text"` |
| A `Button`'s label `Text`, a `MenuItem`'s title `Text`, a `TabButton`'s label | `"none"` — unchanged |

Add the renderer and header-cell cases to a new `packages/lib/tests/component/table/CellTextSelection.test.ts`, following the harness setup in [`CustomRenderer.test.ts`](packages/lib/tests/component/table/CustomRenderer.test.ts) (`installTestDOM` in `beforeEach`, `DOM.reset()` in `afterEach`). Put the `Markdown` case in the existing [`Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts) and the `Dialog` case in [`Dialog.test.ts`](packages/lib/tests/overlay/Dialog.test.ts).

The two `Notification` messages have no unit case: `Notification.show()` returns `void` and both `Text`s are private with no accessor, so neither is reachable from a test. They are covered by the manual checks below.

### Manual verification only

The offline harness records `dispatchEvent` without invoking listeners and returns `[]` from `elementsFromPoint`, so no drag, click or selection gesture can be driven in a test — the scope note at the top of [`DragManager.test.ts`](packages/lib/tests/overlay/DragManager.test.ts) states this. Verify these in the browser (`npm run dev`, `http://localhost:8015`):

| Case | Expectation |
|---|---|
| `#/markdown` — drag across a paragraph | The prose highlights; Ctrl+C copies it |
| `#/markdown` — drag inside a fenced code block | Still selectable (CodeMirror owns it; unchanged) |
| `#/complex` — drag across two cells of one table row | The cell values highlight |
| `#/complex` — drag across two rows | Values from both rows highlight |
| `#/complex` — single click on a row | The row is selected, as today |
| Double-click a cell in any column wired with an editor | The cell editor opens, as today |
| `#/complex` — drag a column header's right edge | The column resizes; no text highlights |
| `#/complex` — drag across a column header | Nothing highlights |
| `#/misc` → "Show window with tree table!" — drag one row onto another | The row reparents; **no** text highlight appears during or after the drag |
| `#/misc` → "Dialog — OK only" | The dialog's message can be selected and copied |
| `#/misc` → any notification button | The toast message can be selected; double-clicking it opens the detail dialog, whose message can also be selected and copied |
| `#/md-editor` — drag across the left editor surface | Selects, as today |
| `#/md-editor` — drag across the right viewer | Now selects (this is the surface that was broken) |
| Any tab strip, button, menu item | Dragging highlights nothing |

### Accepted side effects

- A drag that selects text inside a table body also lands a row selection, because the browser fires `click` on the two targets' common ancestor and `Body`'s subtree click listener sees the row. This matches what a plain click already does, so no suppression is added.
- Double-clicking a `Notification` message selects the word under the cursor before the detail dialog opens over it.
- A `TreeTable` row cannot be text-selected by pressing and dragging, because the row-reparent drag claims that gesture. Double-click (word) and click-then-shift-click (range) still select there.

---

## Verification

1. `npm run typecheck` — clean.
2. `npm run test` — the new cases above pass, and no existing test regresses. Pay attention to `packages/lib/tests/component/table/` and `packages/lib/tests/overlay/`.
3. `npm run lint` — clean. No new raw DOM access is introduced; every write goes through `Component.setUserSelect`.
4. Three greps pin the scope:
   - `grep -c setUserSelect` over `packages/lib/src/typescript/lib/component/table/cell/renderer/` — two code lines per file, seven files.
   - `grep -c setUserSelect` over `packages/lib/src/typescript/lib/component/table/cell/*.ts` — two code lines each in `Header.ts`, `ParentHeader.ts`, `GroupSeparator.ts`, none elsewhere.
   - `grep -rl setUserSelect packages/lib/src/typescript/lib/` — exactly these files and no others: `core/Component.ts` (the setter's own definition and JSDoc), `component/container/Scrollbar.ts`, `component/display/Markdown.ts`, `component/editor/MarkdownEditor.ts`, `overlay/Dialog.ts`, `overlay/Notification.ts`, the seven renderers, and the three opted-out cells. In particular, nothing under `component/button/`, `component/menubar/` or `component/list/`.
5. `npm run docs:api` — finishes with zero warnings (the JSDoc rule in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
6. Walk the manual table above in the running app.

---

## Documentation Impact

No exported symbol, option or signature changes, so the TypeDoc API surface is unchanged and no catalog or sidebar entry moves. Three prose pages plus the changelog need a line:

- [`packages/lib/docs/components/Markdown.md`](packages/lib/docs/components/Markdown.md) — state that rendered prose is selectable and copyable.
- [`packages/lib/docs/components/Table.md`](packages/lib/docs/components/Table.md) — state that cell values are selectable while headers are not, and that on a `TreeTable` the row-reparent drag takes precedence over press-and-drag text selection.
- [`packages/lib/docs/recipes/custom-cell.md`](packages/lib/docs/recipes/custom-cell.md) — tell authors of a custom `CellRenderer` that their content is not selectable unless they call `setUserSelect("text")` on the renderer and on any `Component` holding the text, and show the two-line snippet.
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — the entries from step 12.

---

## Potential Challenges

- **The `Text` opt-in is easy to forget.** A renderer that gets `setUserSelect("text")` but whose `Text` child does not looks correct in the source and does nothing at runtime; both lines are required. The unit tests above assert each half separately, so a missing line fails a test rather than surfacing as a silent no-op.
- **`HeaderCell` reuses `StringRenderer`.** Skipping the three opt-out steps silently makes column titles, parent-header bands and group-separator labels selectable. Step 6's grep check catches this.
- **`onMouseMove` has six returns.** Missing one leaves the selection growing from that branch onward — most visibly the "same target as last frame" branch, which is the one that fires on nearly every frame of a real drag. Step 7's grep check catches this.
- **The drag suppression is untestable offline.** It only shows up in the browser, so the `TreeTable` row in the manual table is not optional.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — the `"none"` seed at line 541, `setUserSelect` at 4525, the `applyStyle` flush at 4860, and `writeRuleDeclaration` at 4603 (which skips a write that matches the class rule, and therefore passes `"text"` through).
- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — the framework-wide rule at line 44 and the per-class body at line 90.
- [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L383) — the precedent this plan mirrors.
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts`](packages/lib/src/typescript/lib/component/table/cell/renderer/CellRenderer.ts) — the base every renderer extends; read it before editing the seven.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L89) — the double-click-to-edit wiring that depends on the renderer, not the `Text`, being the pointer target.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts#L816) — the one subtree `click` listener that drives row selection.
- [`packages/lib/src/typescript/lib/overlay/DragManager.ts`](packages/lib/src/typescript/lib/overlay/DragManager.ts) — `onSourceMouseDown` at 323, `onMouseMove` at 491, the 4 px threshold at 185.
- [`packages/lib/tests/component/table/CustomRenderer.test.ts`](packages/lib/tests/component/table/CustomRenderer.test.ts) — the harness setup the new test file copies.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the return-value disposition protocol step 7 relies on, and the typed-setter rule every other step follows.

---

## Non-Goals

- **Tooltip content stays unselectable.** This matches native desktop tooltips and was decided outside this plan.
- **`CodeEditor` is not modified.** It was checked in the running app and already selects and copies.
- **`Text`'s own default does not change.** Flipping it would make every button label, tab title and menu item selectable.
- **No new API.** No option, setter, getter or seam method is added; `Component.setUserSelect` already covers every case.
- **Consumer-authored `CellRenderer` subclasses are not made selectable automatically.** They opt in the same way the built-ins do; the recipe page documents how.
- **`MarkdownMinimap` is untouched.** It is built on `Tree`, not `Markdown`, and its entries are navigation chrome.
- **Table footer rows are untouched.** `FooterRow` renders no cell text today.

---

## Notes

[^why-per-site]: Three broader options were rejected. Flipping `Component`'s own default would make every label in the framework selectable, including buttons, tabs and menu items — the exact regression this plan exists to avoid. Adding a `selectable?: boolean` option to `ComponentOptions` would add consumer-facing API for what is currently five internal call sites, against the project's "no configurability that wasn't requested" rule. Introducing a shared class rule keyed on cell class names would tie selection behaviour to constructor names, which the pending minification-safe-class-names work is trying to stop relying on.

[^cascade-evidence]: Checked in the running app at `http://localhost:8015`. Setting `user-select: text` on a `Text` whose parent `Panel` computes `none` gives the `Text` a computed value of `text`, and a real drag across two such labels selected their text — so a descendant's explicit `text` does override an ancestor's `none`. The reverse was also checked on a table row: with `user-select: text` on the `Text` alone (the renderer left at `none`) a drag selected nothing, because the pointer lands on the renderer and a selection cannot start in a `user-select: none` element. With `text` on the renderer alone (the `Text` left at `none`) a drag also selected nothing, because the `Text`'s own declaration excluded its content. Only both together produced a selection.

[^pointer-events-kept]: An earlier candidate was to drop `pointer-events: none` from the cell `Text` so the pointer lands on the text itself. A live check confirmed that also works, but it moves the event target from the renderer to the `Text` — and `Cell` wires double-click-to-edit with `Event.addListener(renderer, 'dblclick', …)`, which matches the exact target id. Editing would silently stop activating. Keeping `pointer-events: none` and opting in on both elements achieves the same selection with no routing change at all.

[^why-opt-out]: `HeaderCell`, `ParentHeaderCell` and `GroupSeparatorCell` all extend `DefaultCell`, whose renderer is a `StringRenderer`; there is no seam that separates them from body cells at construction. Two alternatives were considered and dropped. Giving the header cells their own renderer class duplicates `StringRenderer` for one CSS declaration. Moving the opt-in up to `Row`'s cell factory would need a `getText()` on the `CellRenderer` base — new public API — and would still leave `TreeCellRenderer`'s delegate to forward it. Three two-line restatements, each sitting beside the `getText()` calls those constructors already make, is the smaller change. A group-separator label is data-derived and would be harmless to select, but it renders as a header band, so it follows the header rule rather than the value rule.

[^drag-conflict-evidence]: Reproduced in the running app. Every `TreeTable` wires reparent handlers unconditionally at [`TreeTable.ts:140`](packages/lib/src/typescript/lib/component/table/TreeTable.ts#L140), and `TreeBody` then registers each pool row as a drag source at [`TreeBody.ts:611`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L611). With cell text made selectable by hand, dragging from one tree row to another left the string `"docs3/5/2024main.ts3201/14/2024"` in `window.getSelection()` — a text selection painted straight through the drag gesture, and still there after the drop. `DragManager`'s gesture is mouse-based (`mousedown` arms it, `mousemove` drives it past a 4 px threshold), not HTML5 drag-and-drop, so the browser's selection machinery runs in parallel with it and nothing today calls `preventDefault`.

[^why-not-mousedown]: Calling `preventDefault()` on the drag source's `mousedown` is the more common fix and was rejected here. `mousedown`'s default action also moves focus, and `DragManager`'s three drag sources are `TreeBody` rows, `TabBar` tab buttons and `Window` headers — suppressing focus on all three to fix a table-selection artifact is a much wider behaviour change than the problem warrants. Preventing on `mousemove` instead reaches only the selection: the collapsed caret placed by `mousedown` is invisible, nothing extends it, and double-click word selection and shift-click range selection keep working because neither is a `mousemove` default action.

[^editing-hosts]: The comment at `MarkdownEditor.ts:170-174` claims the surface stays selectable because Lexical stamps `user-select: text` on its root. That claim was checked against Lexical 0.49.0's source — `LexicalEditor.setRootElement` does write `style.userSelect = 'text'` inline ([`node_modules/lexical/src/LexicalEditor.ts:1645`](node_modules/lexical/src/LexicalEditor.ts#L1645)) — and against the running app, where the surface computes `user-select: text` and a real drag across it selected `" WYSIWYG editor whose value"`. The comment is accurate but incomplete: the surface is also a `contenteditable` editing host, which the browser exempts from `user-select: none` on its own. `CodeEditor` proves that half independently — its `.cm-content` computes `user-select: none`, inherited from the framework rule on the `CodeEditor` root, and a real drag across it still selected `"function greet(na"`. What the user actually hit was the *other* half of the same demo panel: `MarkdownEditorPanel` puts the `MarkdownEditor` on the left and a read-only `Markdown` viewer on the right, and a drag across the same sentence selected text on the left and nothing on the right.

---

## Implementation Notes

**Step 7's `mousemove`-only suppression did not stop the selection; `DragManager` also intercepts `selectstart` now.** The plan's `^drag-conflict-evidence` and `^why-not-mousedown` footnotes describe verifying, in the running app, that returning `{ stop: true, prevent: true }` from every `onMouseMove` exit is sufficient to suppress the browser's drag-selection. Re-running that exact repro during this implementation's manual-verification pass (dragging one `TreeTable` row onto another via real mouse events) showed the opposite: `window.getSelection().toString()` was non-empty after the drop, even though the shipped `onMouseMove` change was in place. Direct instrumentation (monkey-patching `Event.prototype.preventDefault` to count calls) confirmed `preventDefault()` *was* being called on every `mousemove` of the gesture — the call has no effect on the browser's selection-extension in this environment; only `preventDefault()` on `mousedown` itself, or on the `selectstart` event, actually suppresses it.

Switching to `mousedown`-based suppression would reopen exactly the risk `^why-not-mousedown` explains it was rejected to avoid: `mousedown`'s default action also moves focus, across all three `DragManager` sources (`TreeBody` rows, `TabBar` tabs, `Window` headers), not just the one that motivated this plan. `selectstart` is narrower — it fires only when the browser is about to start a text selection, so intercepting it leaves every other `mousedown` default action, focus included, untouched.

`DragManager` now also registers a `"selectstart"` viewport listener in `onSourceMouseDown` (alongside the existing `mousemove`/`mouseup` pair) and removes it in `endSession`, so it is live only for the press-to-release window of an actual drag source — including a plain click that never crosses the threshold, where losing the (invisible) collapsed-caret placement a real `selectstart` would otherwise produce has no observable effect on a non-editable table cell. Re-verified live after this change: the same `TreeTable` row-reparent drag now leaves `window.getSelection()` empty both during and after the drop, the reparent itself still commits correctly, a `Window` header drag still moves the window (position confirmed via `getBoundingClientRect()` before/after), and plain-click row selection / double-click-to-edit on the non-tree `Table` are unaffected (neither goes through `DragManager`). The `mousemove` return-value change from step 7 is kept as specified — it is harmless and still a reasonable default-suppression on the move events themselves — with `selectstart` added as the mechanism that actually satisfies the "no text highlight during or after the drag" acceptance criterion.
