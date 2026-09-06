---
depends-on: [markdown-editor-toolbar-component]
---

# Markdown Editor Toolbar Live State — Implementation Plan

## Overview

`MarkdownDocumentPanel`'s toolbar ([packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts:110](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L110)) shows the five format buttons, the Table button, and the Alignment/Columns/Table dropdowns as static chrome — nothing about them reflects what the caret currently sits in. This plan makes them live: the five format buttons become real `ToggleButton`s that press/release as the selection's bold/italic/underline/strikethrough/code state changes, the Table button highlights while the caret is inside a table, and the Alignment, Columns, and Table dropdowns show a checkmark on whichever value currently applies.

The live signal comes from a new `MarkdownEditor` API: a `"selectionstate"` event plus a matching `getSelectionState()` getter, both built on `MarkdownEditor`'s existing single `editor.registerUpdateListener` registration ([MarkdownEditor.ts:2119](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2119)) — no second Lexical listener is added. The format-flag computation is factored out of the existing `$classifyContextMenuTarget` ([MarkdownEditor.ts:674](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L674)) into a shared helper so the right-click menu and the toolbar report identical format state from one piece of logic. Block alignment and column count have no existing read-side anywhere in this file (the context menu's own Alignment/Columns submenus have no checkmark either) — this plan adds it, via a climb to the enclosing `MarkdownBlockNode` that already exposes `getAlign()`/`getColumns()` ([markdownBlockNode.ts:146](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L146), [:193](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L193)).

The Table button's highlighted state needs a visual mechanism `MenuButton` doesn't have today (it extends `Button`, not `ToggleButton`, and has no persistent non-click "active" look). This plan adds one declared CSS state, `.contextActive`, directly on `MenuButton`, mirroring exactly how `ToggleButton` added `.selected` over `Button.ownStyleStates`.

---

## Architecture Decisions

### The live signal is `editor.registerUpdateListener`, not `SELECTION_CHANGE_COMMAND`

`MarkdownEditor` computes the new state from the same `editor.registerUpdateListener(() => this.handleChange())` registration `handleChange()` already uses, adding one more statement to that callback rather than a second registration.[^update-listener-vs-selection-command]

### Format flags are shared with the context menu via one extracted helper

`$classifyContextMenuTarget`'s inline `hasFormat`/`formatState` block ([MarkdownEditor.ts:677-684](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L677-L684)) becomes a standalone function, `$readFormatFlags(selection, expansion)`, called by both `$classifyContextMenuTarget` and the new `$readSelectionState()`. Neither call site duplicates the word-expansion-aware `hasFormat` logic, and both report the same thing a format toggle would actually act on.[^shared-format-helper]

### `$readSelectionState` is purpose-built, not a reuse of `$classifyContextMenuTarget`

The new reader computes only what the toolbar needs — the five format flags (via the shared helper), table-cell presence and column alignment, enclosing-block alignment, and column count. It skips everything `$classifyContextMenuTarget` computes only for the right-click menu: `linkUrl`, `hasSelectedText`, `hasEnclosingBlock`, and the `kind` discriminant. It also takes no node parameter — unlike the context menu (which classifies whatever DOM node was clicked), the toolbar has no click target, so it reads directly off `$getSelection()`, the same way the file's own `$getEnclosingTableCellNode` ([MarkdownEditor.ts:165](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L165)) already does.[^why-not-reuse-classify]

### Table/column-alignment detection reuses existing functions verbatim

`$getEnclosingTableCellNode()` and `$tableCellAlignment()` already read from `$getSelection()` with no parameters — they need no changes at all for the new reader to call them.

### Block alignment and column count are new reads, added the same way the setters already write

`setBlockAlignment`/`setColumnCount` ([MarkdownEditor.ts:1629](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1629), [:1674](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1674)) both climb to the enclosing block via `$findMatchingParent(selection.anchor.getNode(), $isMarkdownBlockNode)`. The new reader does the same climb and calls the already-public `MarkdownBlockNode.getAlign()` / `.getColumns().length` — no new node-level API, no plumbing gap.

### `getSelectionState()` recomputes fresh on every call; only the emit path is deduped

Mirrors `CodeEditor.getCursorPosition()` exactly: it re-derives from the live Lexical state each call (or returns a neutral default before the editor is built), never from a cache. `updateSelectionState()` — the method called from the update listener — is the only place that compares against a remembered value (`_lastSelectionState`) before deciding whether to emit, mirroring `CodeEditor.onCursorChange`'s dedup against `_lastCursorPosition` ([CodeEditor.ts:1259-1268](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1259-L1268)).[^getter-vs-cache]

### `MarkdownDocumentPanel`'s dropdowns read the getter directly; no separate cached-state field on the panel

The Alignment, Columns, and Table dropdowns' `menuItems` become provider functions (`() => this.buildXMenuItems()`) that call `this._editor.getSelectionState()` at open time. `MenuButton` already re-invokes its provider on every open ([MenuButton.ts:203-209](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L203-L209)), and the getter is already always-fresh, so the panel needs no second copy of the state.

### The Table button's highlight is a new declared state on `MenuButton`, not a one-off hack

`MenuButton` gains `.contextActive`, appended to `Button.ownStyleStates` exactly the way `ToggleButton` appends `.selected` ([ToggleButton.ts:63-73](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L63-L73)), plus a `setContextActive(boolean)` / `isContextActive()` pair and a matching `contextActive?: boolean` option. This is the framework's existing mechanism for "a persistent visual state that isn't a literal click-toggle" (ARCHITECTURE.md, *Component CSS tiers and state-rule dedup*) — adding a feature to an existing component, not introducing a new one.[^why-menubutton-not-a-new-class]

### `.contextActive` reuses `ToggleButton`'s visual tokens

Its declared bag uses the same `--ts-ui-toggle-selected-bg` / `--ts-ui-toggle-selected-shadow` tokens `ToggleButton.selected` uses, duplicated as a small `MenuButton`-local constant (the source constant is module-private to `ToggleButton.ts`). This keeps one consistent "this control's condition currently holds" look across the whole toolbar — the format `ToggleButton`s, the source-mode `ToggleButton`, and the Table `MenuButton` all read the same way when engaged.

### The right-click context menu's own Alignment/Columns submenus are left unchanged

Only `MarkdownDocumentPanel`'s toolbar dropdowns gain checkmarks. See [Non-Goals](#non-goals).

### No explicit `off("selectionstate", ...)` in `MarkdownDocumentPanel`

Mirrors the existing `"change"` subscription (`this._editor.on("change", this.handleEditorChange)`, [MarkdownDocumentPanel.ts:94](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L94)), which has no matching `off()` either — `MarkdownEditor`'s own `_listeners` bag is registered via `registerListenerBag` ([MarkdownEditor.ts:974](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L974)), so it is cleared automatically when `_editor` (a registered child) is destroyed, per `Component.registerListenerBag`'s own contract ([Component.ts:940-955](packages/lib/src/typescript/lib/core/Component.ts#L940-L955)). The new subscription follows the same, already-established treatment.

---

## Public API

```typescript
// MarkdownEditor.ts

export interface MarkdownEditorSelectionState {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    code: boolean;
    underline: boolean;
    inTable: boolean;
    tableColumnAlignment: MarkdownTableAlignment | null;   // null when inTable is false
    blockAlignment: MarkdownBlockAlignment | null;          // null outside a `:::` block, or when it carries no alignment
    columnCount: number;                                    // 1 outside a `:::` block
}

type MarkdownEditorEvent = "change" | "selectionstate";

interface MarkdownEditorOptions {
    // ... unchanged fields ...
    listeners?: {
        change?: (payload: MarkdownEditorChange) => void;
        selectionstate?: (payload: MarkdownEditorSelectionState) => void;
    };
}

class MarkdownEditor {
    // New:
    getSelectionState(): MarkdownEditorSelectionState;

    on(event: "change", listener: (payload: MarkdownEditorChange) => void): this;
    on(event: "selectionstate", listener: (payload: MarkdownEditorSelectionState) => void): this;

    off(event: "change", listener: (payload: MarkdownEditorChange) => void): this;
    off(event: "selectionstate", listener: (payload: MarkdownEditorSelectionState) => void): this;

    protected emit(event: "change", payload: MarkdownEditorChange): void;
    protected emit(event: "selectionstate", payload: MarkdownEditorSelectionState): void;
}
```

```typescript
// MenuButton.ts

interface MenuButtonOptions {
    // ... unchanged fields ...
    /** Persistent highlighted state, independent of click/hover. Default `false`. */
    contextActive?: boolean;
}

class MenuButton {
    // New:
    setContextActive(value: boolean): this;
    isContextActive(): boolean;
}
```

`MarkdownDocumentPanel`'s own public surface is unchanged — no new public members, per its existing docblock ("delegates only `getValue()`/`setValue()`/`markClean()`/the `"change"` event"). The new wiring is entirely internal (private fields, private methods).

---

## Internal Structure

### `MarkdownEditor.ts` — shared format-flag helper (replaces the inline block in `$classifyContextMenuTarget`)

```typescript
function $readFormatFlags(
    selection: BaseSelection | null,
    expansion: WordExpansion | null,
): { bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean } {
    const hasFormat = (type: TextFormatType): boolean => expansion !== null
        ? (expansion.format & TEXT_TYPE_TO_FORMAT[type]) !== 0
        : $isRangeSelection(selection) && selection.hasFormat(type);

    return {
        bold: hasFormat("bold"), italic: hasFormat("italic"),
        strikethrough: hasFormat("strikethrough"), code: hasFormat("code"),
        underline: hasFormat("underline"),
    };
}
```

`$classifyContextMenuTarget`'s own body changes only its first few lines:

```typescript
export function $classifyContextMenuTarget(node: LexicalNode): ContextMenuTarget {
    const selection = $getSelection();
    const expansion = $computeWordExpansion();
    const formatState = $readFormatFlags(selection, expansion);
    const hasSelectedText = expansion !== null
        || ($isRangeSelection(selection) && selection.getTextContent() !== "");
    // ... unchanged from here down ...
```

### `MarkdownEditor.ts` — the new reader

```typescript
function $readSelectionState(): MarkdownEditorSelectionState {
    const selection = $getSelection();
    const expansion = $computeWordExpansion();
    const format = $readFormatFlags(selection, expansion);
    const cell = $getEnclosingTableCellNode();
    const anchor = $isRangeSelection(selection) ? selection.anchor.getNode() : null;
    const block = anchor === null ? null : $findMatchingParent(anchor, $isMarkdownBlockNode);

    return {
        ...format,
        inTable: cell !== null,
        tableColumnAlignment: cell !== null ? $tableCellAlignment(cell) : null,
        blockAlignment: (block?.getAlign() ?? null) as MarkdownBlockAlignment | null,
        columnCount: block !== null ? block.getColumns().length : 1,
    };
}

const NEUTRAL_SELECTION_STATE: MarkdownEditorSelectionState = {
    bold: false, italic: false, strikethrough: false, code: false, underline: false,
    inTable: false, tableColumnAlignment: null, blockAlignment: null, columnCount: 1,
};

function selectionStatesEqual(a: MarkdownEditorSelectionState, b: MarkdownEditorSelectionState): boolean {
    return a.bold === b.bold && a.italic === b.italic && a.strikethrough === b.strikethrough
        && a.code === b.code && a.underline === b.underline
        && a.inTable === b.inTable && a.tableColumnAlignment === b.tableColumnAlignment
        && a.blockAlignment === b.blockAlignment && a.columnCount === b.columnCount;
}
```

`MarkdownEditor` gains a field seeded to the neutral default (mirrors `CodeEditor._lastCursorPosition`):

```typescript
private _lastSelectionState: MarkdownEditorSelectionState = NEUTRAL_SELECTION_STATE;
```

The getter and the update-driven emitter:

```typescript
getSelectionState(): MarkdownEditorSelectionState {
    const editor = this._editor;

    return editor ? editor.read(() => $readSelectionState()) : NEUTRAL_SELECTION_STATE;
}

private updateSelectionState(): void {
    const editor = this._editor;

    if (!editor) {
        return;
    }

    const state = editor.read(() => $readSelectionState());

    if (selectionStatesEqual(state, this._lastSelectionState)) {
        return;
    }

    this._lastSelectionState = state;
    this.emit("selectionstate", state);
}
```

The registration in `ensureEditor()` ([MarkdownEditor.ts:2119](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2119)) changes from:

```typescript
editor.registerUpdateListener(() => this.handleChange()),
```

to:

```typescript
editor.registerUpdateListener(() => {
    this.handleChange();
    this.updateSelectionState();
}),
```

### `MenuButton.ts` — the declared state

```typescript
const CONTEXT_ACTIVE_DECLARATIONS: Readonly<Record<string, string | null>> = Object.freeze({
    boxShadow:       "var(--ts-ui-toggle-selected-shadow, 2px 2px 1px inset grey)",
    backgroundColor: "var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))",
    backgroundImage: "var(--ts-ui-toggle-selected-bg, none)",
});

class MenuButton<TOptions extends MenuButtonOptions = MenuButtonOptions> extends Button<TOptions> {
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        ...Button.ownStyleStates,
        {
            selector: ".contextActive",
            extract: (): StyleBag => ({
                shadow:          CONTEXT_ACTIVE_DECLARATIONS.boxShadow!,
                backgroundColor: CONTEXT_ACTIVE_DECLARATIONS.backgroundColor!,
                backgroundImage: CONTEXT_ACTIVE_DECLARATIONS.backgroundImage!,
            }),
        },
    ];

    setContextActive(value: boolean): this {
        this.setStyleState(".contextActive", value);

        return this;
    }

    isContextActive(): boolean {
        return this.isStyleState(".contextActive");
    }
    // ... applyOptions dispatches options.contextActive through setContextActive when defined ...
}
```

### `MarkdownDocumentPanel.ts` — applying a snapshot to the toolbar

```typescript
private applySelectionState(state: MarkdownEditorSelectionState): void {
    this._boldBtn.setSelected(state.bold);
    this._italicBtn.setSelected(state.italic);
    this._underlineBtn.setSelected(state.underline);
    this._strikethroughBtn.setSelected(state.strikethrough);
    this._codeBtn.setSelected(state.code);
    this._tableBtn.setContextActive(state.inTable);
}
```

Wired in the constructor alongside the existing `"change"` forwarding:

```typescript
this._editor.on("change", this.handleEditorChange);
this._editor.on("selectionstate", this.handleSelectionState);

this._toolbar = this.buildToolbar();

super.addComponent(this._toolbar, { placement: Placement.NORTH });
super.addComponent(this._editor,  { placement: Placement.CENTER });

this.applySelectionState(this._editor.getSelectionState());
```

### Worked example — what `$readSelectionState()` reports

| Caret context | `inTable` | `tableColumnAlignment` | `blockAlignment` | `columnCount` |
| --- | --- | --- | --- | --- |
| Plain paragraph, no `:::` fence | `false` | `null` | `null` | `1` |
| Inside `::: {align=center}` ... `:::` | `false` | `null` | `"center"` | `1` |
| Inside a 3-column `::: columns` region | `false` | `null` | `null` | `3` |
| Inside a table cell whose column has no `:`-marker | `true` | `"none"` | `null` | `1` |
| Inside a table cell whose column is `:---:` | `true` | `"center"` | `null` | `1` |
| A multi-cell drag `TableSelection` (no anchor `RangeSelection`) | `false`[^tableselection-scope] | `null` | `null` | `1` |

---

## Ordered Implementation Steps

1. **`MarkdownEditor.ts` — extract `$readFormatFlags`.** Add the `BaseSelection` type to the existing `import type { ... } from "lexical"` line ([MarkdownEditor.ts:25](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L25)). Add the new module-level `$readFormatFlags(selection, expansion)` function near `$computeWordExpansion` (it depends on `WordExpansion`, already file-local). Update `$classifyContextMenuTarget` to call it instead of its inline block.
   Check: `grep -n "hasFormat" packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` shows the closure only inside `$readFormatFlags` now, not duplicated.

2. **`MarkdownEditor.ts` — add `MarkdownEditorSelectionState`.** Add the exported interface near `MarkdownEditorChange` ([MarkdownEditor.ts:79](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L79)). Widen `MarkdownEditorEvent` to `"change" | "selectionstate"` ([:84](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L84)) and update its doc comment to list both events (mirror `CodeEditor.ts:65-76`). Widen `MarkdownEditorOptions.listeners` ([:130](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L130)) to add the optional `selectionstate` callback.

3. **`MarkdownEditor.ts` — convert `on`/`off`/`emit` to per-event overloads.** Replace the single non-overloaded signatures ([:2009-2036](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2009-L2036)) with the CodeEditor-style overload pairs (`on(event: "change", ...)`, `on(event: "selectionstate", ...)`, then the implementation signature; same shape for `off`/`emit`). Mirror `CodeEditor.ts:1278-1361` exactly. Done here, before the code that calls the new `emit` overload exists yet, so nothing downstream ever compiles against the stale single-event signature.
   Check: `npm run typecheck --workspace packages/lib` (or the project's equivalent) — the existing `panel.getEditor().on('change', ...)` and any other `"change"`-only call sites must still resolve without a cast.

4. **`MarkdownEditor.ts` — add `$readSelectionState`, `NEUTRAL_SELECTION_STATE`, `selectionStatesEqual`.** Place them after `$classifyContextMenuTarget` (they depend on it only indirectly, through the shared helper). `$readSelectionState` calls `$readFormatFlags`, the existing `$getEnclosingTableCellNode`/`$tableCellAlignment`, and a new `$findMatchingParent(anchor, $isMarkdownBlockNode)` climb (same call already used in `setBlockAlignment`/`setColumnCount`).

5. **`MarkdownEditor.ts` — add the field, getter, and update-driven emitter.** Add `private _lastSelectionState: MarkdownEditorSelectionState = NEUTRAL_SELECTION_STATE;` near `_cleanValue` ([:1000](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1000)). Add `getSelectionState()` near `getValue()` ([:1115](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1115)). Add `private updateSelectionState(): void` near `handleChange()` ([:2711](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2711)) — its `this.emit("selectionstate", state)` call needs step 3's overload already in place.

6. **`MarkdownEditor.ts` — wire the registration.** Change the `editor.registerUpdateListener(...)` entry inside `ensureEditor()`'s `mergeRegister(...)` call ([:2119](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2119)) to call both `this.handleChange()` and `this.updateSelectionState()`.

7. **`MenuButton.ts` — add the `.contextActive` declared state.** Add the `StyleBag`/`StyleStateSpec` import (mirror `ToggleButton.ts:4`). Add the `CONTEXT_ACTIVE_DECLARATIONS` module constant and the `ownStyleStates` override (appends to `Button.ownStyleStates`, mirroring `ToggleButton.ts:63-73`). Add `contextActive?: boolean` to `MenuButtonOptions`. Add `setContextActive`/`isContextActive`. Dispatch `options.contextActive` in `applyOptions` ([MenuButton.ts:153-167](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L153-L167)).
   Check: `new MenuButton({ contextActive: true }).isContextActive()` returns `true`, offline, no DOM required.

8. **`MarkdownDocumentPanel.ts` — promote the five format buttons and the Table button to fields.** Add `private readonly _boldBtn!: ToggleButton;`, `_italicBtn!: ToggleButton;`, `_underlineBtn!: ToggleButton;`, `_strikethroughBtn!: ToggleButton;`, `_codeBtn!: ToggleButton;`, and `_tableBtn!: MenuButton<MenuButtonOptions>;` near the existing `_editor`/`_toolbar` fields ([MarkdownDocumentPanel.ts:74-75](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L74-L75)) — definite-assignment `!:` because they're assigned inside `buildToolbar()`, not the constructor body directly, mirroring `Button.ts:431`'s `private _text!: Text;`.

9. **`MarkdownDocumentPanel.ts` — convert the five format buttons to `ToggleButton`, assign fields.** In `buildToolbar()` ([:110-170](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L110-L170)), replace each `const xBtn = new Button({ glyph: ..., text: ..., showText: false })` with `this._xBtn = new ToggleButton("...", { glyph: "...", showText: false })` (positional text, matching the existing `sourceToggle` construction at `:156`). Keep the five `.on("action", ...)` wiring bodies unchanged. Replace `tableBtn`'s local `const` with `this._tableBtn = ...`. Update `bar.addComponents(...)` to reference the new field names in the same order (no reordering).

10. **`MarkdownDocumentPanel.ts` — make Alignment/Columns/Table menuItems reactive.** In `buildAlignmentMenuItems()`/`buildColumnsMenuItems()` ([:271-289](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L271-L289)) and the "Align column" submenu inside `buildTableMenuItems()` ([:186-228](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L186-L228)), read `this._editor.getSelectionState()` once at the top of each method and add `checked: current === <value>` to every item, mirroring `buildColumnAlignmentItems`'s shape ([MarkdownEditor.ts:2619-2627](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2619-L2627)). Change the three construction sites (`alignmentBtn`, `columnsBtn`, `tableBtn`) from `menuItems: this.buildXMenuItems()` to `menuItems: () => this.buildXMenuItems()`.

11. **`MarkdownDocumentPanel.ts` — wire the live event and seed initial state.** Add `MarkdownEditorSelectionState` to the existing `import type { MarkdownEditorChange } from "~/component/editor/MarkdownEditor.js";` line ([:17](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L17)). Add `private readonly handleSelectionState: (state: MarkdownEditorSelectionState) => void = (state) => this.applySelectionState(state);` near `handleEditorChange` ([:80-81](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L80-L81)). Add `private applySelectionState(state: MarkdownEditorSelectionState): void` (see Internal Structure). In the constructor, subscribe `this._editor.on("selectionstate", this.handleSelectionState)` right after the existing `.on("change", ...)` line, and call `this.applySelectionState(this._editor.getSelectionState())` once after `buildToolbar()` runs.

12. **Fix the test this plan breaks.** In `markdown-document-panel.test.ts`'s `"MarkdownDocumentPanel toolbar action wiring (native click dispatch)"` test ([:119-133](packages/lib/tests/component/markdown-document-panel.test.ts#L119-L133)), `panel.getToolbar().getComponents().find((c): c is ToggleButton => c instanceof ToggleButton)` currently matches the sole `ToggleButton` (the source-mode toggle). After step 9 there are six `ToggleButton`s in the toolbar, and `.find()` returns the first — the Bold button — breaking this test. Change the lookup to also filter on text, matching the pattern already used a few lines above for the format buttons: `(c): c is ToggleButton => c instanceof ToggleButton && c.getText() === 'Edit Markdown source'`.
   Check: this test passes both before and after step 9 is applied (run it in isolation once mid-implementation if useful).

13. **Update `"MarkdownDocumentPanel toolbar structure"`'s format-button assertions** ([:205-218](packages/lib/tests/component/markdown-document-panel.test.ts#L205-L218)) to assert `toBeInstanceOf(ToggleButton)` for `children[0..4]` (still true today only via `Button`; make it precise) instead of `toBeInstanceOf(Button)` / `not.toBeInstanceOf(MenuButton)`.

14. **Add `MarkdownEditor` unit tests** for `getSelectionState()` and `on('selectionstate', ...)` in `markdown-editor.test.ts` — see Expected Behaviour for the concrete cases, using the file's existing `lexicalOf`/`selectStart` helpers ([markdown-editor.test.ts:86-88](packages/lib/tests/component/markdown-editor.test.ts#L86-L88), [:154-157](packages/lib/tests/component/markdown-editor.test.ts#L154-L157)).

15. **Add `MarkdownDocumentPanel` unit tests** for the `ToggleButton` wiring and the dropdown checkmarks in `markdown-document-panel.test.ts`, using the file's existing `findMenuButton`/`resolveItems`/`findItem` helpers ([:39-82](packages/lib/tests/component/markdown-document-panel.test.ts#L39-L82)).

16. **Add `MenuButton` unit tests** for `setContextActive`/`isContextActive`/`contextActive` option in `MenuButton.test.ts`, mirroring `ToggleButton.test.ts`'s `isSelected`/`setSelected` coverage.

17. **Update docs and changelog** — see Documentation Impact.

18. **Run the full check.** Typecheck, then `npm test` (or the project's test command) for `markdown-editor.test.ts`, `markdown-document-panel.test.ts`, and `MenuButton.test.ts`.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/MenuButton.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-document-panel.test.ts` |
| Modify | `packages/lib/tests/component/MenuButton.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownDocumentPanel.md` |
| Modify | `packages/lib/docs/components/MenuButton.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

`MarkdownEditor.getSelectionState()` / `"selectionstate"` (unit-testable, offline, via `lexicalOf`/`selectStart`-style helpers):

- Fresh `new MarkdownEditor()`, never built: `getSelectionState()` returns the neutral default (`bold`/`italic`/`strikethrough`/`code`/`underline`/`inTable` all `false`, `tableColumnAlignment`/`blockAlignment` both `null`, `columnCount` `1`).
- `setValue('**bold** word')` then a selection placed inside the bold run: `getSelectionState().bold` is `true`; the other four format flags are `false`.
- Caret collapsed at the very start of a bold run: `getSelectionState().bold` is `true` too — the same word-expansion-aware read `$classifyContextMenuTarget` already uses (a collapsed caret reports the format the enclosing run carries, not the empty-selection default).
- `setValue('::: {align=center}\ntext\n:::')`, caret inside: `blockAlignment` is `"center"`, `columnCount` is `1`.
- `setValue('::: columns\nA\n|||\nB\n:::')`, caret in either column: `columnCount` is `2`, `blockAlignment` is `null`.
- `setValue(<a 2-column table>)`, caret in a `:---:`-aligned column's cell: `inTable` is `true`, `tableColumnAlignment` is `"center"`.
- `setValue(<a table with a plain `---`-only column>)`, caret in that column: `inTable` is `true`, `tableColumnAlignment` is `"none"`.
- Caret outside any table: `inTable` is `false`, `tableColumnAlignment` is `null`, regardless of document content.
- A drag-selected multi-cell `TableSelection` (no `RangeSelection` anchor): every field reports its "not applicable" default (`inTable: false`, all format flags `false`) — matching the existing scope limit of `$getEnclosingTableCellNode`/`$selectionIsInTableCell`.[^tableselection-scope]
- `on('selectionstate', fn)`: `fn` is not called for the editor's initial load (mirrors `CodeEditor`'s `"cursorchange"`: "the event does not fire for the editor's initial position"). Two consecutive commits that don't change any tracked field (e.g., typing plain unformatted text) fire the listener at most once, not once per keystroke — `off('selectionstate', fn)` stops delivery.
- A command that changes format without moving the selection (e.g. `toggleBold()` on an existing wide selection) still triggers a `"selectionstate"` emit — this is exactly why the plan hooks `registerUpdateListener` rather than `SELECTION_CHANGE_COMMAND` (manual-verify: a native `selectionchange` DOM event does not fire when only the format changes and the selection range is unchanged, so a design relying on `SELECTION_CHANGE_COMMAND` alone would miss this case; not offline-testable since it depends on Lexical's native-event wiring, but the `registerUpdateListener`-based design sidesteps the distinction entirely by firing on every commit regardless of cause).

`MenuButton.setContextActive`/`isContextActive` (unit-testable, offline):

- `new MenuButton().isContextActive()` is `false` by default.
- `setContextActive(true)` then `isContextActive()` is `true`; `setContextActive(false)` reverts it.
- `new MenuButton({ contextActive: true }).isContextActive()` is `true` — construction-time option routes through the setter.

`MarkdownDocumentPanel` toolbar wiring (unit-testable, offline, via the existing `findMenuButton`/`resolveItems`/`findItem` test helpers):

- Immediately after construction (no interaction), all five format `ToggleButton`s report `isSelected() === false` and the Table `MenuButton` reports `isContextActive() === false` — the neutral initial snapshot.
- After `panel.setValue('**bold**')` and placing the selection inside the bold run (via the test file's `selectStart`-style helper), `panel's Bold ToggleButton.isSelected()` becomes `true`, and the other four stay `false`.
- Placing the caret inside a table cell makes the Table `MenuButton.isContextActive()` become `true`; moving it back out makes it `false` again.
- Opening the Alignment dropdown with the caret inside a `center`-aligned `:::` block: `buildAlignmentMenuItems()`'s `"Center"` entry carries `checked: true`, and the other four (`Left`/`Right`/`Justify`/`Default`) carry `checked: false`.
- Opening the Columns dropdown with the caret outside any `:::` block: the `"None"` entry carries `checked: true`.
- Opening the Table dropdown's "Align column" submenu with the caret outside a table: none of the four entries carry `checked: true` (all `false`) — matching the existing "always enabled, no-op-safe outside a table" behaviour the dropdown already has for its actions.
- Clicking the Bold `ToggleButton` (native click dispatch, per the existing test's pattern) still calls `MarkdownEditor.toggleBold()` and the resulting value still contains the format marker — the `ToggleButton`'s own click-driven self-flip of `.selected` is harmless because the `"selectionstate"` emit inside `toggleBold()`'s own `editor.update`/`dispatchCommand` calls corrects it to the real value synchronously, within the same click handler.[^togglebutton-self-flip]

---

## Verification

- Typecheck the whole `packages/lib` workspace — the `on`/`off`/`emit` overload conversion is the change most likely to surface a stale non-literal call site.
- `grep -n "hasFormat" packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — the closure appears exactly once, inside `$readFormatFlags`.
- Run `packages/lib/tests/component/markdown-editor.test.ts`, `packages/lib/tests/component/markdown-document-panel.test.ts`, and `packages/lib/tests/component/MenuButton.test.ts`.
- Manual smoke test (`npm run dev`, per `project_dev_urls` — the app at `localhost:8015`): open the `MarkdownEditorPanel` demo, click inside bold/italic text and confirm the matching toolbar buttons press; click inside a table and confirm the Table button highlights; open the Alignment/Columns dropdowns over differently-aligned content and confirm the checkmark tracks the caret.
- `npm run docs:api` if the project's link-check test (`docs/api` dangling-link guard) is part of CI, since `MarkdownEditorSelectionState` is a new exported symbol.

---

## Documentation Impact

- **`packages/lib/docs/components/MarkdownEditor.md`**: add `selectionstate` to the `listeners` construction-table row ([:35](packages/lib/docs/components/MarkdownEditor.md#L35)); add a "Live selection state" section (after "Common methods" or "Formatting") documenting `getSelectionState()` and `on('selectionstate', fn)`, mirroring `CodeEditor.md`'s "Cursor position" section ([CodeEditor.md:159-173](packages/lib/docs/components/CodeEditor.md#L159-L173)) — including the "the event does not fire for the editor's initial position, seed with the getter" phrasing. Add a row to the "Common methods" table.
- **`packages/lib/docs/components/MarkdownDocumentPanel.md`**: the "Toolbar" section's closing sentence ([:32](packages/lib/docs/components/MarkdownDocumentPanel.md#L32)) — "The Table dropdown is always enabled: it never inspects the caret's live position the way a right-click classification does" — is no longer accurate for the checkmarks (though the *enabled* claim stays true). Revise to note the dropdown items stay always-enabled/no-op-safe, but the Table button and the Alignment/Columns/Table dropdown checkmarks now do reflect live caret position. Mention the five format buttons are `ToggleButton`s that press/release with the current selection.
- **`packages/lib/docs/components/MenuButton.md`**: add a short section documenting `setContextActive`/`isContextActive`/`contextActive`, alongside the existing "Menu items" section.
- **`packages/lib/docs/reference/changelog/next.md`**: append bullets under the existing `## Added` › `### Components` heading ([:113-115](packages/lib/docs/reference/changelog/next.md#L113-L115), following the existing `MarkdownDocumentPanel` bullet at [:209-217](packages/lib/docs/reference/changelog/next.md#L209-L217)):
  - `MarkdownEditor` gains a `"selectionstate"` event and `getSelectionState()` getter reporting the five inline-format flags, table/column-alignment context, and block alignment/column count at the current selection.
  - `MarkdownDocumentPanel`'s five format buttons are now `ToggleButton`s whose pressed state tracks the current selection; the Table button highlights while the caret is inside a table; the Alignment, Columns, and Table dropdowns show a checkmark on the current value.
  - `MenuButton` gains a `.contextActive` state (`setContextActive`/`isContextActive`/the `contextActive` option) for a persistent highlighted look independent of click/hover.

---

## Potential Challenges

- **Overload conversion regressions.** Converting `MarkdownEditor.on`/`off`/`emit` from one signature to two overloads can break a call site that stored `"change"` in a non-literal `MarkdownEditorEvent`-typed variable. Mitigation: `grep -rn '\.on(.*MarkdownEditor' packages/lib/src` before and after; the typecheck step catches any real breakage.
- **`registerUpdateListener` already does real work per commit.** `handleChange()` already runs a full `$convertToMarkdownString` on every commit, including pure caret moves — this plan's addition is a handful of shallow ancestor climbs, strictly cheaper than what already runs on the same hot path today. No new performance risk, but don't compound it later by adding anything document-sized to `updateSelectionState()`.
- **`ToggleButton`'s own click-driven self-flip.** Clicking a format `ToggleButton` flips its `.selected` state locally before the wired `"action"` handler runs (see `ToggleButton.onAction()`). This plan relies on the synchronous `"selectionstate"` emit inside `toggleBold()` et al. to correct it within the same click — see [^togglebutton-self-flip].

---

## Critical Files

- [packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — everything in Steps 1–6.
- [packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts) — everything in Steps 8–11.
- [packages/lib/src/typescript/lib/component/button/MenuButton.ts](packages/lib/src/typescript/lib/component/button/MenuButton.ts) — Step 7.
- [packages/lib/src/typescript/lib/component/button/ToggleButton.ts](packages/lib/src/typescript/lib/component/button/ToggleButton.ts) — the precedent `.selected` declared-state shape Step 7 mirrors exactly.
- [packages/lib/src/typescript/lib/component/editor/CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — the precedent `"cursorchange"`/`getCursorPosition()` shape (getter recomputes fresh, event is deduped against a remembered value) Steps 3–6 mirror.
- [packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts) — `MarkdownBlockNode.getAlign()`/`.getColumns()`, the existing read-side Step 3 calls.
- [packages/lib/tests/component/markdown-document-panel.test.ts](packages/lib/tests/component/markdown-document-panel.test.ts) — read in full before Step 12; the toggle-lookup break is easy to miss without seeing the existing `.find()` call.
- `~/.claude/CODE_CONVENTIONS.md`, `ARCHITECTURE.md` — the event-surface split, the declared-style-state mechanism, and the options-bag rules this plan follows.

---

## Non-Goals

- **`MarkdownEditor`'s own right-click context menu is not touched.** Its Alignment ([MarkdownEditor.ts:2497-2509](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2497-L2509)) and Columns ([:2404-2417](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2404-L2417)) submenus stay checkmark-free. The user's request was specifically about the toolbar; retrofitting the context menu (a separate, already-shipped surface) with the same checkmarks is a reasonable follow-up but out of scope here.
- **No reordering or regrouping of the toolbar.** The button/dropdown order established by the `markdown-editor-toolbar-component` plan is unchanged.
- **No `TableSelection` (multi-cell drag) support for the live state.** `inTable`/`tableColumnAlignment` follow the same `RangeSelection`-only scope `$getEnclosingTableCellNode` already has. Extending it is a separate, larger change to that shared helper.
- **No new theming tokens.** `.contextActive` reuses `ToggleButton`'s existing `--ts-ui-toggle-selected-*` custom properties rather than introducing new ones.

---

## Notes

[^update-listener-vs-selection-command]: Lexical dispatches `SELECTION_CHANGE_COMMAND` from two places: unconditionally at the end of the native-`selectionchange`-driven `onSelectionChange` handler (`node_modules/lexical/src/LexicalEvents.ts:489`, itself wrapped in a synchronous `updateEditorSync` commit), and, separately, from `$commitPendingUpdates` (`node_modules/lexical/src/LexicalUpdates.ts:763-769`) but *only* when the new selection is not a `RangeSelection` (a `NodeSelection`/`TableSelection` change). Critically, a format toggle applied via command (e.g. `MarkdownDocumentPanel`'s own `toggleBold()` call, which dispatches `FORMAT_TEXT_COMMAND` without moving the caret) changes content but not the selection's anchor/focus, so no native `selectionchange` DOM event fires and neither `SELECTION_CHANGE_COMMAND` dispatch path fires either — a design hooked only on `SELECTION_CHANGE_COMMAND` would miss exactly the case of the user clicking the toolbar's own Bold button. `editor.registerUpdateListener` has no such gap: every one of these cases — typing, a pure caret move (also routed through a synchronous `updateEditorSync` commit per `LexicalEvents.ts:351`), undo/redo, and a same-position format toggle — commits a new `EditorState` and fires the update listener, which is exactly the set of cases `handleChange()` already relies on for the `"change"` event today.

[^shared-format-helper]: `$classifyContextMenuTarget` runs once per right-click (infrequent); the new reader runs on every editor commit (frequent — every keystroke and caret move). Both computations are the same handful of O(selection depth) operations (a bitmask check, at most one ancestor climb), so performance is not what decides the shared-helper question — correctness is: extracting the helper guarantees the toolbar's pressed state and the context menu's checkbox state can never drift apart, since they run the identical `hasFormat` closure over the identical inputs.

[^why-not-reuse-classify]: Reusing `$classifyContextMenuTarget(node)` wholesale would require synthesizing a `node` argument from `$getSelection()`'s anchor for every selection-change tick (the toolbar has no DOM click target to resolve one from), and would compute `linkUrl` (an ancestor climb through `$findEnclosingLinkNode`) and `hasEnclosingBlock` (another climb through `$findEnclosingInsertableBlock`) on every keystroke for values nothing in this plan uses. Neither is expensive per call, but there is no reason to pay either cost, or to carry the `kind` discriminated-union branching, on a hot path that only wants five booleans plus table/block context.

[^getter-vs-cache]: The alternative — caching the last-computed state on `MarkdownEditor` and having `getSelectionState()` return the cache — would still be correct (the cache is always at least as fresh as the last commit, and nothing can change the selection between commits), but it duplicates state unnecessarily: `editor.read(() => $readSelectionState())` is cheap enough to call on demand (see the Potential Challenges note on `registerUpdateListener` already doing heavier work per commit), so there is no benefit to also maintaining a cache purely for the getter. `_lastSelectionState` still exists, but only to answer "did anything tracked actually change since the last emit" for the dedup — a question the getter itself doesn't need to answer.

[^why-menubutton-not-a-new-class]: The alternative — a dedicated `ToggleMenuButton` subclass combining `ToggleButton`'s selected-state visuals with `MenuButton`'s dropdown behaviour — would need to merge two sibling classes' logic (both extend `Button` independently) for one call site. Widening `MenuButton` with one more declared state costs one array entry, one constant, and a two-method pair — smaller than a new class, and immediately reusable by any future `MenuButton` that wants the same "ambient condition, not a literal toggle" treatment.

[^tableselection-scope]: `$getEnclosingTableCellNode()` (`MarkdownEditor.ts:165-171`) and the `$selectionIsInTableCell()` it backs already carry this same restriction — `unmergeTableCell()`'s own "no-op without throwing when the caret is not inside a table cell" doc comment describes a `RangeSelection`-only check, not a `TableSelection`-aware one. `mergeTableCells()` is the only place in this file that reads a `TableSelection` directly (`$isTableSelection(selection)`, `MarkdownEditor.ts:1932`), specifically because merging requires the whole selected cell range, not a single anchor cell — a need `$readSelectionState()` (which only needs "is the caret in a table" and "this one column's alignment") does not share.

[^togglebutton-self-flip]: `ToggleButton.onAction()` (`ToggleButton.ts:281-285`) runs on the DOM `"click"` listener wired in its own constructor, ahead of any external `"action"` listener (which fires on the `"change"` event `onAction()` itself dispatches) — so `setSelected(!isSelected())` always runs before `MarkdownDocumentPanel`'s `() => this._editor.toggleBold()` handler does. This is harmless here because `toggleBold()`'s own `editor.update(...)`/`editor.dispatchCommand(FORMAT_TEXT_COMMAND, ...)` calls are synchronous commits that each run the `registerUpdateListener` callback (and therefore `updateSelectionState()`) before `toggleBold()` returns — so by the time the click handler stack unwinds, `applySelectionState` has already been called with the real post-toggle value, correcting whatever the self-flip guessed. No change to `ToggleButton` or to the wiring is needed to make this correct.
