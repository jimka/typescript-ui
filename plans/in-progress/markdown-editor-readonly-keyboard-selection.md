---
depends-on: [markdown-editor-list-item-block-paste]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/src/typescript/lib/core/Aria.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# MarkdownEditor Read-Only Keyboard Navigation and Selection — Implementation Plan

## Overview

A read-only `MarkdownEditor` shows no caret on its WYSIWYG surface and takes no keyboard focus. [`setReadOnly(true)`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4375) turns the surface's `contenteditable` off through [`applyContentEditable`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5807), so a keyboard user cannot move through the text, select it or copy it. The source surface, a read-only `CodeEditor`, keeps its caret and keyboard selection.

This plan gives the WYSIWYG surface the same. A read-only editor is a tab stop, shows a caret, moves and selects with the keyboard and the mouse, copies with Ctrl/Cmd+C, and opens its Copy-only context menu from the keyboard. No input route can change the document or the undo history. What the stack already decided about read-only stays: every editing command is refused through `commandApplies`, every `can…` field reports `false`, the menu offers only Copy, and `setValue()` stays allowed.

The change is in the library only. It touches `MarkdownEditor.ts` (the private `WysiwygSurface` class and the editor), adds two small modules beside it, moves the read-only flash out of `CodeEditor.ts` into a shared helper, and adds one role and one setter to `core/Aria.ts`. Line numbers are for commit `63a81117d`, the tip of `feature/markdown-raw-block-html-tail-parity`. Branches that land below this one move them, so find each symbol by name.

---

## Architecture Decisions

### Read-only keeps `contenteditable` on, and four layers refuse edits

The surface stays `contenteditable` while the editor is read-only. That attribute is what gives the browser a caret, keyboard navigation and a tab stop. Edits are refused by four layers, each closing what the one before it leaves open:

| # | Layer | Lives in | What it stops | Status |
|---|---|---|---|---|
| 1 | Lexical is not editable (`editor.setEditable(false)`) | `setReadOnly`, `buildEditor` | Lexical acting on the surface's keyboard, input, composition, clipboard and drag events | exists, unchanged |
| 2 | Command guard | new `registerReadOnlyGuard` | every Lexical command that can edit, whoever dispatches it | new |
| 3 | Edit intents cancelled | `WysiwygSurface` | the browser editing the shown text by itself | new |
| 4 | Uncancelled input undone | `WysiwygSurface` and `MarkdownEditor.restoreShownText` | text the browser changed anyway reaching the document | new |

The public command methods keep their own gate, `commandApplies`, in front of all four.

Keeping `contenteditable` on mirrors [`CodeEditor`'s `buildReadOnlyExtension`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L383): the model refuses every edit while the content DOM stays editable, so the caret and selection keep working.[^mechanism]

### The browser moves the caret, and Lexical follows it

No keyboard handling is added. Lexical ignores `keydown` while it is not editable, so arrows, Shift+arrows, Home/End, word and line movement, Ctrl/Cmd+A, double and triple click and drag selection are the browser's own. Lexical reads the browser's selection on every `selectionchange`, which it handles whether editable or not, and the editor's update listener then reports `"selectionstate"`.[^native-nav]

What the selection state reports is unchanged: every `can…` field is `false`, and `bold`, `italic`, `linkUrl`, `hasSelectedText`, `inTable`, `tableColumnAlignment`, `blockAlignment` and `columnCount` follow the caret ([`readActiveSelectionState`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4283)).

### The surface cancels the browser's edit intents

An edit intent is an event by which the browser announces an edit before making it. `WysiwygSurface` registers subtree listeners for these events through the `Event` class, as it already does for `contextmenu` ([MarkdownEditor.ts:3661](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3661)). While the surface is read-only the listeners act as follows. While the surface is editable they do nothing.

| DOM event | Action | Reported as a refused edit? |
|---|---|---|
| `beforeinput`, cancelable (typing, Enter, Backspace/Delete, spellcheck replacement, drag-move, browser undo/redo, Ctrl+B and the other format shortcuts) | `preventDefault` | yes |
| `beforeinput`, not cancelable (a composition's text) | none | no — `compositionstart` already reported it |
| `paste`, `cut`, `drop` | `preventDefault` | yes |
| `compositionstart` | none | yes |
| `input` | asks the editor to restore the shown text (next decision) | no |
| `keydown`, `copy`, `dragstart`, pointer and focus events | not listened to | — |

A cancelled `cut` copies nothing, which matches `MarkdownEditor.cut()` on a read-only editor.[^edit-intents]

### Input that could not be cancelled is undone

A composition (IME input) cannot be cancelled: its `beforeinput` is not cancelable. The browser then changes the shown text. Lexical's mutation observer watches the DOM for changes Lexical did not make, does not check the editable flag, and would copy that text into the document.

An `input` event on a read-only surface therefore makes the editor run `editor.update($markAllTextDirty, { tag: HISTORY_MERGE_TAG })`. That call is a normal update, which commits a moment later, and not a discrete one, which commits at once. The update marks every text node dirty, which is Lexical's word for "changed in this update".

Lexical never takes text from the DOM for a node that is already dirty, and it rewrites a dirty node's DOM from the document when the update commits. The document, the node keys and the undo history stay as they were, and no `"change"` fires.[^restore]

One visible limit remains in Chromium: when the restore rewrites a text run, the caret moves to the start of that run.[^caret-jump]

### A command guard at the head of every editing command

`registerReadOnlyGuard` registers one listener per command at `COMMAND_PRIORITY_BEFORE_CRITICAL`, which Lexical runs before every other listener. While the editor is read-only the listener reports the refusal and returns `true`, so no handler runs. `registerReadOnlyGuard` mirrors [`registerRangeGuards`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2745), which also guards a list of commands ahead of their handlers.

The rule is an allow-list. Four commands pass, because read-only needs them and none of their handlers edits: `COPY_COMMAND`, `CLICK_COMMAND`, `SELECTION_CHANGE_COMMAND`, `FOCUS_COMMAND`. Every other command the editor has a handler for is refused. Both lists are exported, and a test compares them with the commands actually registered on a mounted editor, so a command added later fails the test until it is classified.[^guard]

### While read-only the editor does not move the selection

Lexical writes its selection to the browser only while editable. So while read-only the browser's selection is the only one, and the editor never sets one of its own:

| Call | Editable | Read-only |
|---|---|---|
| `focus()` in WYSIWYG mode | Lexical's `editor.focus()` | `this._wysiwyg.focus(preventScroll)` — the browser keeps a caret it already holds in the surface, else puts one at the document's start |
| `refocusSurface()` | Lexical's `editor.focus()` | `this._wysiwyg.focus()` |
| `copy()` at a collapsed caret | selects the enclosing word, then copies it | copies the enclosing word without selecting it |

`copy()` on a read-only editor therefore starts no Lexical update.[^selection-owner]

### `setContentEditable` no longer depends on read-only

`MarkdownEditor.setContentEditable` forwards to the surface again, as it does on `master`, and `getContentEditable()` returns what was last set. Read-only does not change the attribute, and the attribute cannot lift read-only: a `contenteditable` surface of a read-only editor still refuses every edit. The editor's `_contentEditable` field and `applyContentEditable` are removed.[^content-editable]

### A refused edit is reported the same way on both surfaces

`MarkdownEditor` gains a public `"readonlyedit"` event with no payload, as `CodeEditor` has. The event fires once for each refused edit. The WYSIWYG surface also plays the flash `CodeEditor` plays: a brief error-coloured wash over the whole editor.

| Refusal | Event fires | Flash |
|---|---|---|
| The surface cancels an edit intent or sees `compositionstart` | once | WYSIWYG wash |
| The command guard refuses a Lexical command | once | WYSIWYG wash |
| A public command is refused in WYSIWYG mode (`commandApplies`, `toggleLink`, `cut`, `paste`) | once | WYSIWYG wash |
| The source `CodeEditor` fires its own `"readonlyedit"` | once, re-emitted | the source editor's own |

The wash is one shared helper, `ReadOnlyFlash`, moved out of `CodeEditor.ts`. `CodeEditor` uses it with no change in behaviour and gains no Markdown-specific API.[^feedback]

### The surface is exposed as a multi-line text box

The surface gets `role="textbox"` and `aria-multiline="true"` always, and `aria-readonly` following the read-only state, through `getAria()`. These are the attributes CodeMirror puts on the source surface's content element. No `tabindex` is written: a `contenteditable` element is a tab stop by itself, and the framework's `FOCUSABLE_SELECTOR` already matches it. Tab and Shift+Tab leave a read-only surface, because nothing there takes the key.[^aria]

### Links are not followed

A click on a link places the caret, as in the editable editor. The editor has no link-opening behaviour in either state.[^links]

---

## Public API

```typescript
// component/editor/MarkdownEditor.ts
type MarkdownEditorEvent = "change" | "selectionstate" | "readonlyedit";

export interface MarkdownEditorOptions extends ComponentOptions {
    // …existing fields…
    listeners?: {
        change?:         (payload: MarkdownEditorChange) => void;
        selectionstate?: (payload: MarkdownEditorSelectionState) => void;
        readonlyedit?:   () => void;
    };
}

class MarkdownEditor {
    /** Fired when an edit is refused because the editor is read-only, on either surface. */
    on(event: "readonlyedit", listener: () => void): this;
    off(event: "readonlyedit", listener: () => void): this;
    protected emit(event: "readonlyedit"): void;
}
```

```typescript
// core/Aria.ts
export type AriaRole = /* …existing members… */ | 'textbox';

class Aria {
    /** Sets `aria-multiline`. */
    setMultiline(value: boolean): this;
    /** Returns the current `aria-multiline` value, or null if not set. */
    getMultiline(): boolean | null;
}
```

Unchanged signatures whose documented behaviour changes: `setReadOnly`, `focus`, `setContentEditable`, `getContentEditable`, `copy`. Their JSDoc is rewritten in step 9.

Module exports that are not in the barrel:

```typescript
// component/editor/markdownReadOnly.ts (new)
export const READ_ONLY_ALLOWED_COMMANDS: readonly LexicalCommand<unknown>[];
export const READ_ONLY_REFUSED_COMMANDS: readonly LexicalCommand<unknown>[];
export function registerReadOnlyGuard(editor: LexicalEditor, isReadOnly: () => boolean, onRefused: () => void): () => void;
export function $markAllTextDirty(): void;

// component/editor/ReadOnlyFlash.ts (new)
export class ReadOnlyFlash {
    mount(host: Handle, zIndex: number): Handle;   // creates the wash under `host`; the caller tracks the returned handle
    play(): void;                                  // no-op before mount
    cancel(): void;                                // stops a running pulse
}
```

`WysiwygSurface` is private to `MarkdownEditor.ts`. Its state-bearing addition: accessor `getReadOnly()`, setter `setReadOnly(readOnly)`, backing field `private _readOnly: boolean = false`. It has no options field, because the surface is constructed only by the editor and takes the value as a constructor argument, as it took `contentEditable` before.

---

## Internal Structure

### `markdownReadOnly.ts`

```typescript
export const READ_ONLY_ALLOWED_COMMANDS: readonly LexicalCommand<unknown>[] = [
    COPY_COMMAND, CLICK_COMMAND, SELECTION_CHANGE_COMMAND, FOCUS_COMMAND,
];

// The 46 other commands a built and mounted editor has a handler for at 63a81117d.
export const READ_ONLY_REFUSED_COMMANDS: readonly LexicalCommand<unknown>[] = [
    // lexical — the gateways Lexical routes DOM events through
    KEY_DOWN_COMMAND, BEFORE_INPUT_COMMAND, INPUT_COMMAND, COMPOSITION_START_COMMAND, COMPOSITION_END_COMMAND,
    // lexical — keys
    KEY_ENTER_COMMAND, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, KEY_SPACE_COMMAND, KEY_TAB_COMMAND, KEY_ESCAPE_COMMAND,
    KEY_ARROW_UP_COMMAND, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_LEFT_COMMAND, KEY_ARROW_RIGHT_COMMAND,
    MOVE_TO_START, MOVE_TO_END, SELECT_ALL_COMMAND,
    // lexical — text and blocks
    CONTROLLED_TEXT_INSERTION_COMMAND, INSERT_PARAGRAPH_COMMAND, INSERT_LINE_BREAK_COMMAND, INSERT_TAB_COMMAND,
    DELETE_CHARACTER_COMMAND, DELETE_WORD_COMMAND, DELETE_LINE_COMMAND, REMOVE_TEXT_COMMAND,
    FORMAT_TEXT_COMMAND, SET_TEXT_FORMAT_COMMAND, FORMAT_ELEMENT_COMMAND, INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND,
    // lexical — clipboard, drag, history
    CUT_COMMAND, PASTE_COMMAND, SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
    DRAGSTART_COMMAND, DRAGOVER_COMMAND, DROP_COMMAND,
    UNDO_COMMAND, REDO_COMMAND, CLEAR_HISTORY_COMMAND, CLEAR_EDITOR_COMMAND,
    // @lexical/list, @lexical/table
    INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND, UPDATE_LIST_START_COMMAND,
    INSERT_TABLE_COMMAND,
];

export function registerReadOnlyGuard(editor: LexicalEditor, isReadOnly: () => boolean, onRefused: () => void): () => void {
    const refuse = (): boolean => {
        const readOnly = isReadOnly();

        if (!readOnly) {
            return false;
        }

        onRefused();

        return true;
    };

    return mergeRegister(
        ...READ_ONLY_REFUSED_COMMANDS.map((command) => editor.registerCommand(command, refuse, COMMAND_PRIORITY_BEFORE_CRITICAL)),
    );
}

export function $markAllTextDirty(): void {
    for (const node of $getRoot().getAllTextNodes()) {
        node.markDirty();
    }
}
```

`KEY_DOWN_COMMAND` is the export name; its `type` string is `"KEYDOWN_COMMAND"`.

### `WysiwygSurface`

```typescript
type WysiwygSurfaceEvent = "contextmenu" | "readonlyedit" | "uncancelledinput";

constructor(onReady: () => void, readOnly: boolean, subclassDefaults?: Partial<ComponentOptions>) {
    super(undefined, { ..._defaultWysiwygSurfaceOptions, ...(subclassDefaults ?? {}) });

    this._onReady = onReady;

    this.setContentEditable(true);
    this.getAria().setRole("textbox").setMultiline(true);
    this.setReadOnly(readOnly);
    // …existing overflow, padding and line-height writes…

    Event.addSubtreeListener(this, "contextmenu", { prevent: true, handler: this.handleContextMenu });
    Event.addSubtreeListener(this, "beforeinput", this.handleEditIntent);
    Event.addSubtreeListener(this, "paste", this.handleEditIntent);
    Event.addSubtreeListener(this, "cut", this.handleEditIntent);
    Event.addSubtreeListener(this, "drop", this.handleEditIntent);
    Event.addSubtreeListener(this, "compositionstart", this.handleCompositionStart);
    Event.addSubtreeListener(this, "input", this.handleInput);

    this.onFirstLayout(() => this._onReady());
}

setReadOnly(readOnly: boolean): this {
    this._readOnly = readOnly;
    this.getAria().setReadOnly(readOnly);

    return this;
}

private handleEditIntent(event: { cancelable: boolean }): Event.ListenerResult {
    if (!this._readOnly || !event.cancelable) {
        return;
    }

    this.emit("readonlyedit");

    return { prevent: true };
}

private handleCompositionStart(): void {
    if (this._readOnly) {
        this.emit("readonlyedit");
    }
}

private handleInput(): void {
    if (this._readOnly) {
        this.emit("uncancelledinput");
    }
}
```

The disposition depends on runtime state, so it is returned, not set as a registration floor (ARCHITECTURE.md, *Event handling*). `on`, `off` and `emit` get one overload for `"contextmenu"` (payload `MouseEvent`) and one for the two new events (no payload). Their implementation signatures follow [`MarkdownEditor.on`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5725): `listener: Function`, and `emit` fires `this._listeners.fire(event, ...(payload ? [payload] : []))` as [`CodeEditor.emit`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1885) does.

### `MarkdownEditor`

```typescript
/** Above the surface's content, which sets no z-index of its own. */
const WYSIWYG_FLASH_Z_INDEX = 1;

private readonly _flash: ReadOnlyFlash = new ReadOnlyFlash();

// constructor
this._wysiwyg = new WysiwygSurface(() => this.mountWysiwyg(), this._options.readOnly ?? false);
this._wysiwyg.on("contextmenu", (event) => this.handleWysiwygContextMenu(event));
this._wysiwyg.on("readonlyedit", () => this.signalReadOnlyEdit());
this._wysiwyg.on("uncancelledinput", () => this.restoreShownText());
// …and in the CodeEditor's listeners bag:
//     readonlyedit: () => this.emit("readonlyedit"),

private signalReadOnlyEdit(): void {
    this.emit("readonlyedit");
    this._flash.play();
}

private refuseIfReadOnly(): boolean {
    const readOnly = this.getReadOnly();

    if (readOnly) {
        this.signalReadOnlyEdit();
    }

    return readOnly;
}

private restoreShownText(): void {
    const editor = this._editor;

    if (!editor) {
        return;
    }

    // Not discrete: Lexical's mutation observer must run inside this update, before it commits.
    editor.update($markAllTextDirty, { tag: HISTORY_MERGE_TAG });
}

private refocusSurface(): this {
    const readOnly = this.getReadOnly();

    if (readOnly) {
        this._wysiwyg.focus();
    } else {
        this.ensureEditor().focus();
    }

    return this;
}
```

`copyWysiwygSelection` becomes:

```typescript
const editor = this.ensureEditor();
const readOnly = this.getReadOnly();

// A read-only editor leaves the selection to the browser: the word is copied without being selected.
if (!readOnly) {
    editor.update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });
}

const text = editor.read(() => {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return "";
    }

    // Non-null only for a caret still collapsed, which is the read-only case.
    const expansion = $computeWordExpansion();

    if (expansion !== null) {
        return expansion.node.getTextContent().slice(expansion.start, expansion.end);
    }

    const copied = wholeTables && $isTableEdgeRange(selection) ? $grownTableEdgeRange(selection) : selection;

    return copied.getTextContent();
});

if (text !== "") {
    DOM.sink.writeClipboardText(text);
    this.refocusSurface();
}
```

Keep whatever the branches below have made of the `copied` line; only the `readOnly` test, the `expansion` branch and the `refocusSurface()` call are new.

---

## Ordered Implementation Steps

Steps 1–3 have no editor behaviour of their own. Step 4 writes every new test before the editor code; steps 5–8 make them pass.

1. **`core/Aria.ts` — role and setter.** First add `['setMultiline', a => a.getMultiline()]` to the boolean table in `tests/core/Aria.test.ts` (~line 39). Then add `'textbox'` to [`AriaRole`](../packages/lib/src/typescript/lib/core/Aria.ts#L10), and add `setMultiline` / `getMultiline` directly below [`getReadOnly`](../packages/lib/src/typescript/lib/core/Aria.ts#L727), copying `setReadOnly` / `getReadOnly` with the key `"multiline"`. Check: `npx vitest run tests/core/Aria.test.ts`.

2. **`ReadOnlyFlash.ts` — move the wash out of `CodeEditor`.** Create `component/editor/ReadOnlyFlash.ts` holding `READONLY_FLASH_MS`, `READONLY_FLASH_PEAK_OPACITY`, `READONLY_FLASH_COLOR` (moved from [CodeEditor.ts:346–356](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L346), comments included) and the class from `## Public API`. `mount` is the body of [`mountFlashOverlay`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2778) without `trackHandle`, with `zIndex: String(zIndex)`, and returns the overlay handle. `play` is the body of [`flashReadOnly`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2854). `cancel` is the two lines at the top of [`CodeEditor.destructor`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1894). Then in `CodeEditor.ts`:
   - replace the fields `_flashOverlay` and `_flashAnimation` (:493–497) with `private readonly _flash: ReadOnlyFlash = new ReadOnlyFlash();`
   - add `const READONLY_FLASH_Z_INDEX = 400;` carrying the z-index comment now inside `mountFlashOverlay`
   - `mountFlashOverlay(host)` becomes `this.trackHandle(this._flash.mount(host, READONLY_FLASH_Z_INDEX));`
   - `flashReadOnly()` becomes `this._flash.play();`
   - the destructor's two lines become `this._flash.cancel();`
   - the `Animation` import stays: line 1375 still uses it.

   Update the comment at `component/editor/theme.ts:33` to name `ReadOnlyFlash.ts`. Check: `grep -n '_flashOverlay\|_flashAnimation\|READONLY_FLASH_MS' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` finds nothing, and `npx vitest run tests/component/code-editor.test.ts` passes unchanged.

3. **`markdownReadOnly.ts` — guard and restore.** Create the module from `## Internal Structure`, with JSDoc on each export. Do not add it to `component/editor/index.ts`.

4. **Tests first.**
   - Create `tests/component/markdown-editor-readonly-mounted.test.ts` with the harness under `## Expected Behaviour` → *Mounted harness* and the G, R and M cases.
   - In `tests/component/markdown-editor.test.ts`: replace the describe `'MarkdownEditor WYSIWYG surface contenteditable follows readOnly'` (~:359–425) with the S cases; add the C and F cases.
   - In the describe `'in a read-only editor'` (~:5738): `undoDepthOf` dispatches `UNDO_COMMAND`, which the guard will refuse. Call `editor.setReadOnly(false)` after the `reported` assertions and before `undoDepthOf(editor)`. Add a `"readonlyedit"` spy and assert it was called exactly once per command (case C1).

   Check: run both files. The new cases fail; `typecheck:test` fails on `'readonlyedit'` until step 6, which is expected.

5. **`MarkdownEditor.ts` — `WysiwygSurface`.** Apply `## Internal Structure` → `WysiwygSurface`: the event union at [:3600](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3600), the `_readOnly` field, the constructor ([:3633](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3633)), `setReadOnly` / `getReadOnly`, the three handlers, and the `on` / `off` / `emit` overloads. Rewrite the comment above `_defaultWysiwygSurfaceOptions` (:3590–3597) and the constructor's `@param`. The editor's constructor call at [:3939](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3939) passes `this._options.readOnly ?? false` from this step on.

6. **`MarkdownEditor.ts` — wiring.**
   - Constructor ([:3939–3951](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3939)): the two new surface listeners and the `CodeEditor`'s `readonlyedit` listener, as in `## Internal Structure`.
   - Remove the `_contentEditable` field (:3908) and `applyContentEditable` (:5807). `setContentEditable` (:5786) becomes `this._wysiwyg.setContentEditable(contentEditable); return this;`. `getContentEditable` (:5799) keeps its body.
   - `setReadOnly` (:4375): replace `this.applyContentEditable();` with `this._wysiwyg.setReadOnly(readOnly);`.
   - Add `_flash`, `WYSIWYG_FLASH_Z_INDEX`, `signalReadOnlyEdit`, `refuseIfReadOnly`, `restoreShownText`.
   - `buildEditor` (:5871): add `registerReadOnlyGuard(editor, () => this.getReadOnly(), () => this.signalReadOnlyEdit()),` to the `mergeRegister(…)` list.
   - `mountWysiwyg` (:5923): inside the existing `if (editor.getRootElement() && !this._unregisterTableView)` block, read `const host = this.getElement();` and, when `host` is set, call `this.trackHandle(this._flash.mount(host, WYSIWYG_FLASH_Z_INDEX));`.
   - `destructor` (:5820): `this._flash.cancel();` as the first line.
   - `MarkdownEditorEvent` (:261), `MarkdownEditorOptions.listeners` (:307), and the `on` / `off` / `emit` overloads (:5725–5773) per `## Public API`; `emit`'s implementation takes an optional payload.

   Check: the S, G, R and M cases pass, and C4 and C7.

7. **`MarkdownEditor.ts` — the public command gate reports.** Use `refuseIfReadOnly()` at the four read-only tests:
   - [`commandApplies`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4067): `const refused = this.refuseIfReadOnly(); if (refused) { return false; }`
   - [`toggleLink`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4792) (:4797), [`cut`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5016) (:5025), [`paste`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5058) (:5063): the same, in place of `const readOnly = this.getReadOnly();`.

   Check: C1, C2, C3, C5 and C6 pass.

8. **`MarkdownEditor.ts` — focus and copy.** `refocusSurface` (:4089) and `copyWysiwygSelection` (:4965) as in `## Internal Structure`. `focus` (:4403): read `isSourceMode()` and `getReadOnly()` into variables first; source mode forwards to the `CodeEditor` as today, read-only calls `this._wysiwyg.focus(preventScroll)`, otherwise `this.ensureEditor().focus()`. Check: the F cases pass. Then `grep -n 'this.getReadOnly()' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — the hits are `readActiveSelectionState`, `refuseIfReadOnly`, `refocusSurface`, `focus`, `copyWysiwygSelection`, `buildContextMenuItems` and the guard's callback in `buildEditor`, and no others.

9. **JSDoc.** Rewrite to match the new behaviour: `setReadOnly`, `focus`, `refocusSurface`, `setContentEditable`, `getContentEditable`, `copy`, `copyWysiwygSelection`, `commandApplies`, the `MarkdownEditorEvent` list, and `WysiwygSurface.setContentEditable`. Public JSDoc must not `{@link}` `ReadOnlyFlash`, `WysiwygSurface` or anything in `markdownReadOnly.ts`.

10. **Demo.** In `packages/lib/src/typescript/MarkdownEditorPanel.ts`, add a `ToggleButton('Read-only')` to the status row after `saveBtn`, whose `"action"` listener calls `this._editorPanel.getEditor().setReadOnly(readOnlyBtn.isSelected())`. Import `ToggleButton` from `@jimka/typescript-ui/component/button`. The `SAMPLE` string is not changed.

11. **Docs, changelog, migration** — see `## Documentation Impact`.

12. **Full check and manual run** — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownReadOnly.ts` |
| Create | `packages/lib/src/typescript/lib/component/editor/ReadOnlyFlash.ts` |
| Create | `packages/lib/tests/component/markdown-editor-readonly-mounted.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/theme.ts` (one comment) |
| Modify | `packages/lib/src/typescript/lib/core/Aria.ts` |
| Modify | `packages/lib/src/typescript/MarkdownEditorPanel.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/core/Aria.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

Three kinds of case:

- **unit** — offline, modelled DOM, in `markdown-editor.test.ts`.
- **mounted** — offline, jsdom with the real DOM seam, in `markdown-editor-readonly-mounted.test.ts`.
- **manual** — a real browser; listed under X.

"Nothing changes" means all of: `getValue()` is the same string; every node has the same key and type (`nodesOf`); no `"change"` fired; and, once read-only is lifted, the undo depth equals that of a twin editor nothing was done to (`undoDepthOf`). Copy `nodesOf`, `selectionOf` and `undoDepthOf` from `markdown-editor.test.ts` (~:5403–5447).

### Mounted harness

The existing mounted suites hand Lexical a bare `<div>`. These cases need the editor's own surface as the root, so its listeners run:

```typescript
// @vitest-environment jsdom   (first line of the file; do not call installTestDOM)
function mounted(source: string, readOnly: boolean): { editor: MarkdownEditor; lexical: LexicalEditor; root: HTMLElement } {
    const editor = new MarkdownEditor(source, { readOnly });
    const internals = editor as unknown as { _editor: LexicalEditor; _wysiwyg: Component; mountWysiwyg(): void };

    built.push(editor);
    (DOM.sink as ProductionDOMSink).appendChild((DOM.source as ProductionDOMSource).getBody(), editor.getElement(true)!);
    internals._wysiwyg.getElement(true);
    internals.mountWysiwyg();

    return { editor, lexical: internals._editor, root: internals._editor.getRootElement() as HTMLElement };
}

// jsdom has neither class, and Lexical's handlers tell events apart by class name.
beforeEach(() => {
    class ClipboardEvent extends Event {
        clipboardData = { types: ['text/plain'], files: [], getData: (type: string): string => (type === 'text/plain' ? 'PASTED' : ''), setData: vi.fn() };
    }
    class DragEvent extends Event {
        dataTransfer = { types: ['text/plain'], files: [], getData: (): string => 'DROPPED', setData: vi.fn() };
    }

    vi.stubGlobal('ClipboardEvent', ClipboardEvent);
    vi.stubGlobal('DragEvent', DragEvent);
});

afterEach(() => {
    built.splice(0).forEach((editor) => editor.dispose());   // before DOM.reset(), or a queued layout throws
    DOM.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) { await Promise.resolve(); } };
```

Build `paste`, `cut` and `copy` as `new ClipboardEvent(type, { bubbles: true, cancelable: true })`, and `drop` and the drag events as `new DragEvent(…)` the same way. `Event` here is the DOM's class, so this file must not import `~/core/Event`. `InputEvent`, `KeyboardEvent`, `CompositionEvent` and `MouseEvent` exist in jsdom. Dispatch on the text node's parent `<span>` inside `root` unless a row says otherwise. Both stub classes extend jsdom's own `Event`, so the DOM dispatches them; with them an editable editor's `keydown` Enter and `paste` do edit the document through real dispatch, which is what makes the read-only rows worth asserting.

### S — surface attributes (unit)

Read attributes with `attrsOf(DOM.sink as RecordingDOMSink, wysiwygOf(editor).getElement(true))`.

| # | Setup | Expected |
|---|---|---|
| S1 | `new MarkdownEditor('# Hi', { readOnly: true })` | `contenteditable: "true"`, `role: "textbox"`, `aria-multiline: "true"`, `aria-readonly: "true"`; `getContentEditable()` is `true` |
| S2 | `new MarkdownEditor('# Hi')` | the same, with `aria-readonly: "false"` |
| S3 | S2, then `setReadOnly(true)`, then `setReadOnly(false)` | `aria-readonly` is `"true"`, then `"false"`; `contenteditable` stays `"true"` throughout |
| S4 | read-only editor, `setContentEditable(false)`, then `setReadOnly(false)`, then `setContentEditable(true)` | `"false"`, still `"false"`, then `"true"` — only `setContentEditable` moves it |
| S5 | read-only editor, built (`setValue('x')`), `setContentEditable(true)` | Lexical's `isEditable()` is still `false` |

### C — commands and feedback (unit)

| # | Setup | Expected |
|---|---|---|
| C1 | the existing describe `'in a read-only editor'` (~:5738), which runs every command of every availability field on every selection case | as today nothing changes and no Lexical update starts; and `"readonlyedit"` fires exactly once per command |
| C2 | read-only, WYSIWYG: `toggleLink(null)`, `cut()`, `await paste()` | `"readonlyedit"` fires once for each; nothing changes; the clipboard is neither written nor read |
| C3 | editable: `toggleBold()` on a selected word | `"readonlyedit"` does not fire |
| C4 | `new MarkdownEditor('hello', { mode: 'source', readOnly: true })` set up as the existing test `'read-only refuses and signals, leaving the value unchanged'` (~:1450) sets its source editor up; `toggleBold()` | the editor's own `"readonlyedit"` fires exactly once |
| C5 | `new MarkdownEditor('x', { readOnly: true, listeners: { readonlyedit: spy } })`, `toggleBold()` | `spy` called once |
| C6 | read-only editor not built yet, `toggleBold()` | `"readonlyedit"` fires once; the Lexical editor is still not built |
| C7 | read-only editor, `setValue('# New')`, then `setMode('source')` and `setMode('wysiwyg')` | the value is `# New`; `"readonlyedit"` does not fire |

### F — focus and copy (unit)

| # | Setup | Expected |
|---|---|---|
| F1 | read-only, WYSIWYG, built; spies on the surface's `focus` and on `lexicalOf(editor).focus`; `editor.focus(true)` | surface `focus` called once with `true`; Lexical's `focus` not called |
| F2 | editable, WYSIWYG, same spies; `editor.focus()` | Lexical's `focus` called once; the surface's not called |
| F3 | read-only, `mode: 'source'`; `editor.focus(true)` | the `CodeEditor`'s `focus` called with `true` |
| F4 | `hello world`, caret collapsed inside `world`, `setReadOnly(true)`, spy on `lexicalOf(editor).update`; `copy()` | clipboard gets `world`; `selectionOf` is unchanged (still collapsed); `update` not called; the surface's `focus` called once |
| F5 | `hello world`, `world` selected, read-only; `copy()` | clipboard gets `world` (the existing test, unchanged) |
| F6 | F4 without `setReadOnly(true)` | clipboard gets `world` and the selection now spans `world` (today's behaviour) |
| F7 | `a , b`, caret at offset 2 (between the space and the comma, where `$computeWordExpansion()` is `null`), read-only; `copy()` | nothing is written to the clipboard |

### G — command guard (mounted)

| # | Setup | Expected |
|---|---|---|
| G1 | mount a document holding a table and a list; read `[...lexical._commands.keys()]` | every key is in exactly one of `READ_ONLY_ALLOWED_COMMANDS` and `READ_ONLY_REFUSED_COMMANDS`; the two lists share no member |
| G2 | for each command in `READ_ONLY_REFUSED_COMMANDS`: a fresh read-only editor on `hello world\n\n- a\n- b`, the caret in `world`, one earlier edit made before read-only so Undo has a step; `lexical.dispatchCommand(command, payload)` | returns `true`; nothing changes; `selectionOf` is unchanged; `"readonlyedit"` fires exactly once |
| G3 | the same editor, not read-only; `dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined)` | the document changes; `"readonlyedit"` does not fire |
| G4 | read-only, `world` selected; `dispatchCommand(SELECTION_CHANGE_COMMAND, undefined)`, `dispatchCommand(CLICK_COMMAND, new MouseEvent('click'))`, `dispatchCommand(COPY_COMMAND, new ClipboardEvent('copy', { cancelable: true }))`, `dispatchCommand(FOCUS_COMMAND, new FocusEvent('focus'))`; `await settle()` | `"readonlyedit"` does not fire for any of the four; nothing changes |

G2 payloads: give real ones to the rows that prove the guard — `INSERT_PARAGRAPH_COMMAND` `undefined`, `DELETE_CHARACTER_COMMAND` `true`, `DELETE_WORD_COMMAND` `true`, `DELETE_LINE_COMMAND` `true`, `REMOVE_TEXT_COMMAND` `undefined`, `CONTROLLED_TEXT_INSERTION_COMMAND` `'Z'`, `INSERT_LINE_BREAK_COMMAND` `false`, `INSERT_TAB_COMMAND` `undefined`, `FORMAT_TEXT_COMMAND` `'bold'`, `FORMAT_ELEMENT_COMMAND` `'center'`, `INSERT_UNORDERED_LIST_COMMAND` `undefined`, `INSERT_TABLE_COMMAND` `{ rows: '2', columns: '2' }`, `UNDO_COMMAND` `undefined`, `CLEAR_EDITOR_COMMAND` `undefined`, `CLEAR_HISTORY_COMMAND` `undefined`, `PASTE_COMMAND` `new ClipboardEvent('paste')`. Every other command gets `undefined as never`: the guard returns before any handler reads it.

### R — DOM routes into a read-only editor (mounted)

**The route list is derived, not remembered.** While `mounted()` runs `mountWysiwyg()`, spy on `EventTarget.prototype.addEventListener` and collect the type of every listener added to the surface element, to a `<table>` inside it, or to `document`. Restore the spy afterwards. Case R0 asserts that the keys of the test's `ROUTES` table equal that set plus `beforeinput`.[^derive-routes] At `63a81117d` the set is: `blur`, `click`, `compositionend`, `compositionstart`, `copy`, `cut`, `dragend`, `dragover`, `dragstart`, `drop`, `focus`, `input`, `keydown`, `mousedown`, `paste`, `pointerdown`, `selectionchange`.

Every row runs on a read-only editor mounted with `plain **bold** end\n\n| a | b |\n| - | - |\n| c | d |\n\n- one\n- two`, the caret in `plain`, one edit made before read-only. Unless a row says otherwise the expectation is: nothing changes, `"readonlyedit"` does not fire, and the event is not `defaultPrevented`.

| # | Event | Variants | Expected beyond the default |
|---|---|---|---|
| R0 | — | — | `Object.keys(ROUTES)` equals the derived set plus `beforeinput` |
| R1 | `keydown` | `Enter`, `Backspace`, `Delete`, `Tab`, `' '`, `a`, `b`+ctrl, `i`+ctrl, `z`+ctrl, `y`+ctrl, `a`+ctrl, `ArrowRight`, `ArrowLeft`+shift, `Home`, `End`, `Escape` | default only |
| R2 | `beforeinput`, `cancelable: true` | `insertText`, `insertReplacementText`, `insertLineBreak`, `insertParagraph`, `insertFromPaste`, `insertFromDrop`, `insertFromYank`, `deleteContentBackward`, `deleteContentForward`, `deleteWordBackward`, `deleteByCut`, `deleteByDrag`, `historyUndo`, `historyRedo`, `formatBold`, `formatItalic`, `formatUnderline`, `insertOrderedList` | `defaultPrevented` is `true`; `"readonlyedit"` fires once |
| R3 | `beforeinput`, `cancelable: false` | `insertCompositionText`, `deleteCompositionText` | default only |
| R4 | `paste`, `cut`, `drop` | one each | `defaultPrevented` is `true`; `"readonlyedit"` fires once |
| R5 | `compositionstart`; `compositionend` | one each | `compositionstart`: `"readonlyedit"` fires once. `compositionend`: default only |
| R6 | `input` after the browser changed text | set the `plain ` text node's `data` to `plainZ `, dispatch `new InputEvent('input', { inputType: 'insertCompositionText', data: 'Z', bubbles: true })` on `root`, `await settle()` | nothing changes; `root.innerHTML` equals its value from before |
| R7 | `input` after the browser added a node | append `document.createTextNode('Z')` to the first `<p>`, dispatch the same `input`, `await settle()` | as R6 |
| R8 | `input`, shortcut text | document `\# x`, caret at offset 2, set the text node's `data` to `# Zx`, dispatch, `await settle()` | nothing changes — the block stays a paragraph |
| R9 | `copy` | on the selected word `plain`; `await settle()` | nothing changes and `"readonlyedit"` does not fire. Lexical's own copy handler prevents the default, so do not assert on `defaultPrevented` |
| R10 | `dragstart`, `dragover`, `dragend` | one each | default only |
| R11 | `click`, `pointerdown`; `focus`, `blur` on `root`; `mousedown` on a `<td>` | one each | default only |
| R12 | `selectionchange` | set the browser's selection inside `bold` (`getSelection().setBaseAndExtent(text, 1, text, 1)`), dispatch `new Event('selectionchange')` on `document`, `await settle()` | `"selectionstate"` fires once, with `bold: true` and every `can…` field `false` (attach the listener after the setup); nothing changes |
| R13 | `paste` on `document.body` | hold a table selection over cells `c`..`d` (`$setSelection($createTableSelectionFrom(table, c, d))` in a discrete update, as `markdown-editor-context-menu-mounted.test.ts` does), `root.focus()`, dispatch `new ClipboardEvent('paste', …)` on `document.body`, `await settle()` | a spy on `lexical.dispatchCommand` saw `PASTE_COMMAND`; `"readonlyedit"` fires once; nothing changes (without the guard cell `c` becomes `PASTED`) |

Three rows are repeated with the editor **editable**, to pin that the layers stay out of the way: R1 `Enter` splits the paragraph; R4 `paste` puts `PASTED` into the document; R6 leaves `plainZ ` in the document. `"readonlyedit"` fires for none of them.

### M — switching read-only (mounted)

| # | Setup | Expected |
|---|---|---|
| M1 | editable, browser selection set over `bold` (offsets 1–3) and `selectionchange` dispatched; `setReadOnly(true)` | `selectionOf` unchanged; `root.getAttribute('contenteditable')` is `"true"`; `document.activeElement` unchanged |
| M2 | M1, then extend the browser's selection to offset 4 and dispatch `selectionchange`; then `setReadOnly(false)` | Lexical's selection spans offsets 1–4 before and after `setReadOnly(false)` |
| M3 | M2, then `lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Z')` | the selected text is replaced: the editor edits again |
| M4 | mounted read-only editor holding a table, `setValue('| x |\n| - |\n| y |\n\nnew')` | the document is replaced; `"readonlyedit"` does not fire |

### X — manual, real browser

Run in Chromium on the dev demo's MD Editor page (`npm run dev`, `#/md-editor`), with the new Read-only toggle on. Use real key presses and real mouse input. Firefox and WebKit (WebKitGTK is the Tauri target) are also to be run by hand; record each as run or not run.

| # | Gesture | Expected |
|---|---|---|
| X1 | Tab from the toolbar into the editor | the surface takes focus and shows a caret |
| X2 | Arrows, Ctrl/Alt+arrows, Home/End, PageUp/PageDown | the caret moves; nothing flashes |
| X3 | Shift+arrows, Shift+Home/End, Ctrl/Cmd+A | text is selected; Ctrl/Cmd+A selects the editor's content only |
| X4 | Double click, triple click, drag | word, block and range selection |
| X5 | Ctrl/Cmd+C on a selection, paste elsewhere | the selected text arrives |
| X6 | Shift+F10 and the ContextMenu key, with a caret and with a selection | the menu opens at the caret with Copy alone; Escape closes it |
| X7 | Type a letter; Enter; Backspace; Delete; Ctrl+B; Ctrl+I | nothing changes on screen or in `getValue()`; the surface flashes once per key |
| X8 | Tab | focus leaves the editor; no flash |
| X9 | Ctrl/Cmd+V; Ctrl/Cmd+X on a selection | nothing changes; flash; after Ctrl+X the clipboard still holds what it held |
| X10 | Drag selected text and drop it elsewhere in the editor; drag text in from another window | nothing changes |
| X11 | Type while editable, switch read-only on, Ctrl/Cmd+Z, Ctrl/Cmd+Y | nothing changes |
| X12 | A composition: CDP `Input.imeSetComposition` twice, then `Input.insertText`, with the caret in text and in an empty paragraph | `getValue()`, the shown text and the undo depth are unchanged. In Chromium the caret may move to the start of its text run |
| X13 | Select text, switch read-only on, Shift+arrow, switch it off, type a letter | the selection survives both switches; the letter replaces it |
| X14 | Drag across table cells to select them, then Ctrl/Cmd+V | nothing changes; flash |
| X15 | Move the caret through a bold word, into a table cell, into a link | `getSelectionState()` follows the caret (`bold`, `inTable`, `linkUrl`) with every `can…` field `false`; the toolbar's format buttons stay disabled |
| X16 | Arrow past an image and across a table's first and last cells | the caret stays visible and keeps moving. Record what happens; a fault here is a follow-up, not a blocker |
| X17 | Click a link | the caret lands in it; the page does not navigate |
| X18 | Source mode, read-only: type a letter | the source editor flashes as before; a listener on the editor's `"readonlyedit"` is called once |
| X19 | macOS only: accept a spelling or text replacement | nothing changes |

---

## Verification

- `npm run typecheck`, `npm run typecheck:test`, `npm run lint` pass.
- The files this plan touches: `npx vitest run tests/core/Aria.test.ts tests/component/code-editor.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-editor-readonly-mounted.test.ts tests/component/markdown-document-panel.test.ts tests/component/markdown-editor-context-menu-mounted.test.ts`. Then the whole suite, `npm test`.
- `npm run docs:api` finishes with zero warnings; `npm run docs:llms:check` passes; `npm run build:lib` passes.
- **Mutation checks.** Break each layer in turn, confirm the named cases fail, restore:

  | Break | Must fail |
  |---|---|
  | `setReadOnly` and `buildEditor` leave Lexical editable | R1 (`Enter`, `Backspace`: `"readonlyedit"` fires, because the guard now sees the key commands) and S5 |
  | `registerReadOnlyGuard` removed from `buildEditor` | G2 (the rows with real payloads) and R13 |
  | `handleEditIntent` returns nothing | R2 and R4 (`defaultPrevented`) |
  | `handleInput` emits nothing | R6 and R8 (`getValue()` holds the `Z`) |
  | `restoreShownText` passes `{ discrete: true }` | R7 (the stray text node stays in `root.innerHTML`) |
  | `refuseIfReadOnly` does not signal | C1, C2 |
  | `copyWysiwygSelection` expands while read-only | F4 |

- Manual X cases in Chromium. Record Firefox and WebKit as run or not run.

---

## Documentation Impact

`"readonlyedit"` reaches the API docs through `MarkdownEditor.on`'s new overload and `MarkdownEditorOptions.listeners`. `Aria.setMultiline` and the `'textbox'` role reach them through `core`. Nothing new is added to a barrel.

- **`docs/components/MarkdownEditor.md`**
  - Options table ([:35](../packages/lib/docs/components/MarkdownEditor.md#L35)): the `listeners` row gains `readonlyedit?: () => void` and names the third event.
  - *Common methods* ([:262](../packages/lib/docs/components/MarkdownEditor.md#L262)): add a row `on('readonlyedit', fn)` / `off('readonlyedit', fn)` — "Subscribe to edits refused because the editor is read-only."
  - *Read-only* ([:304–312](../packages/lib/docs/components/MarkdownEditor.md#L304)): rewrite the first and last paragraphs. The section must say:
    - a read-only editor keeps its caret on both surfaces: it is a tab stop, moves and selects with the keyboard and the mouse, copies with Ctrl/Cmd+C, and opens its Copy-only context menu with Shift+F10 or the ContextMenu key;
    - nothing changes the document: typing, Enter, Backspace/Delete, paste, cut, drop, dragging selected text, a composition, a spelling replacement, the browser's undo and redo, the format shortcuts and every command are refused; Tab leaves the editor;
    - a refused edit fires `"readonlyedit"` and flashes the surface, on either surface;
    - the surface is exposed as a multi-line text box with `aria-readonly`;
    - `setContentEditable` is separate from read-only: it decides whether the surface hosts a caret at all, and a `contenteditable` surface of a read-only editor still refuses edits;
    - the known limits: Copy at a caret copies the word without selecting it; after a refused composition Chromium may move the caret to the start of its text run; keyboard selection is the browser's, so Shift+arrows across table cells select text, not whole cells.
    Keep the middle paragraphs (commands, `can…` fields, `inTable`, `setValue`, the pointer to `Markdown`).
  - The `cut()` row of the Command API table ([:133](../packages/lib/docs/components/MarkdownEditor.md#L133)): add that Ctrl/Cmd+X is refused the same way.
- **`docs/reference/changelog/next.md`** — the read-only entries are unreleased, so amend them in place:
  - *Fixed › Components*, "A read-only `MarkdownEditor` no longer lets the browser edit its shown text" ([:722](../packages/lib/docs/reference/changelog/next.md#L722)): replace everything from "The surface's `contenteditable` now follows…" with: the surface stays `contenteditable`, so a read-only editor keeps its caret, keyboard navigation, selection and copy, as a read-only `CodeEditor` does; every edit the browser offers is cancelled, and text it changes anyway (a composition) is put back; `setContentEditable` is independent of read-only.
  - *Breaking changes › Components*, "A read-only `MarkdownEditor` refuses its editing commands in WYSIWYG mode too" ([:12](../packages/lib/docs/reference/changelog/next.md#L12)): add one sentence — a refused command fires `"readonlyedit"` and flashes the surface.
  - *Added › Components*: "**`MarkdownEditor` reports refused edits.** The `"readonlyedit"` event fires when an edit is refused because the editor is read-only, in WYSIWYG mode and in source mode, and the WYSIWYG surface flashes as `CodeEditor` does."
  - *Added › Core*: "**`Aria.setMultiline()` / `getMultiline()`** write and read `aria-multiline`, and `AriaRole` gained `'textbox'`."
  - *Changed › Components*: "**`MarkdownEditor`'s WYSIWYG surface is exposed as a multi-line text box.** It carries `role="textbox"`, `aria-multiline="true"` and `aria-readonly`."
- **`docs/reference/migration/next.md`**, section "A read-only `MarkdownEditor` refuses its editing commands" ([:102](../packages/lib/docs/reference/migration/next.md#L102)): add a paragraph under *Who needs to act* — code that calls a command on a read-only editor and relies on it being a silent no-op now also triggers `"readonlyedit"` and the flash; test `getReadOnly()` or the matching `can…` field first.

---

## Potential Challenges

- **More commands than the list holds.** Branches below this one may register commands this plan did not see. G1 names them; add each to `READ_ONLY_REFUSED_COMMANDS` unless read-only needs it and its handlers cannot edit.
- **`undoDepthOf` on a read-only editor reads 0.** `UNDO_COMMAND` is refused. Lift read-only before measuring, after every assertion about events.
- **Lexical registers no `beforeinput` listener under jsdom** (it tests for `getTargetRanges`). R0 adds `beforeinput` by hand for that reason; R2 still passes, because it tests the surface's listener, not Lexical's.
- **A queued layout throws after `DOM.reset()`.** Dispose every mounted editor first, as the harness's `afterEach` does.
- **`Animation.play` under jsdom.** The mounted editor has a wash, so a refused edit starts a timer. `editor.dispose()` cancels it through `_flash.cancel()`; keep that call ahead of `super.destructor()`.
- **Marking every text node dirty runs the editor's text transforms.** They must leave a settled document alone. R6 asserts node keys and types on a document with a table, a list and formatted text; if it fails, the transform that changed a node is the defect, not the restore.
- **`{ cancelable: boolean }` as the handler's parameter type.** It keeps DOM event types out of the signature. If `local/no-raw-dom` accepts `InputEvent` here (it accepts `MouseEvent` on `handleContextMenu`), either is fine.

---

## Critical Files

- [`CodeEditor.ts`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — the precedent: `buildReadOnlyExtension` (:383), the `beforeinput` / `paste` / `drop` hooks (:2289–2297), `onEditIntent` (:2824), `signalReadOnlyEdit` (:2837), `flashReadOnly` (:2854), `mountFlashOverlay` (:2778), the `"readonlyedit"` event (:170–181), `cut` / `paste` (:1438, :1472).
- [`MarkdownEditor.ts`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `WysiwygSurface` (:3614), `registerRangeGuards` (:2745), `$computeWordExpansion` (:2834), `commandApplies` (:4067), `refocusSurface` (:4089), `readActiveSelectionState` (:4283), `setReadOnly` (:4375), `focus` (:4403), `copyWysiwygSelection` (:4965), `buildEditor` (:5871), `mountWysiwyg` (:5923), `handleWysiwygContextMenu` (:5958).
- [`core/Event.ts`](../packages/lib/src/typescript/lib/core/Event.ts) — `addSubtreeListener`, `ListenerResult`, `EventDisposition`.
- [`core/Aria.ts`](../packages/lib/src/typescript/lib/core/Aria.ts) — `setReadOnly` (:716); [`AbstractBooleanInput.ts:138`](../packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L138) is the `getAria().setReadOnly` precedent.
- `node_modules/lexical/src/LexicalEvents.ts` (0.49.0) — `rootElementEvents` (:172–195), `addRootElementEvents` and its `isEditable()` tests (:1922–2000), `onSelectionChange` (:318); `LexicalMutations.ts` — `flushMutations` (:144); `LexicalUtils.ts` — `$updateTextNodeFromDOMContent` (:897); `LexicalUpdates.ts:714` — the `_editable` test on the selection write.
- `node_modules/@lexical/table/src/LexicalTableSelectionHelpers.ts:793` — the document-level `paste` listener.
- [`markdown-editor-context-menu-mounted.test.ts`](../packages/lib/tests/component/markdown-editor-context-menu-mounted.test.ts) and [`activation-after-dispose.test.ts`](../packages/lib/tests/component/activation-after-dispose.test.ts) — the jsdom recipes the mounted harness combines.
- [`plans/implemented/markdown-editor-context-menu-caret.md`](implemented/markdown-editor-context-menu-caret.md) — *Implementation Notes* and the three *Review fixes* sections: how read-only got to where it is.

---

## Non-Goals

- **Working an open context menu from the keyboard.** The menu opens from the keyboard, but its rows are not reached with the arrow keys: no context menu in the library (`Table`, `TextInput`, `CodeEditor`, this editor) forwards keys to `Menu.handleKey`. Ctrl/Cmd+C is the keyboard route to Copy. That is one change across those components.
- **Keeping the caret in place across a refused composition.** Chromium may move it to the start of its text run.[^caret-jump]
- **Lexical's own keyboard handling while read-only** — whole-cell selection with Shift+arrows, its caret mark beside a table or an image. Navigation is the browser's.
- **Touch keyboards.** A read-only surface still raises the on-screen keyboard on focus, as a read-only `CodeEditor` does.
- **Opening links.** The editor does not follow links in either state; the `Markdown` viewer does.
- **Spell-check marks.** The surface keeps the browser's default; only replacements are refused.
- **Tab-key ownership.** `setTabKeyOwner(true)` stays as it is, as on `CodeEditor`.
- **`CodeEditor`'s behaviour.** Only the wash's code moves. Ctrl/Cmd+X in a read-only source editor still copies, which is CodeMirror's own behaviour.
- **Switching read-only on in the middle of a composition.** Not handled before this plan either.

---

## Addendum: What was measured

Measured for this plan in headless Chromium 154 through CDP (real key events, `Input.imeSetComposition`, `Input.insertText`) on a bare Lexical 0.49.0 rich-text editor, and in jsdom on the real `MarkdownEditor`. The probe scripts and their output are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/readonly-keyboard/` (`probe.mjs`, `probe-*.txt`, `feasibility*.test.ts`, `commands.txt`).

| Setup | Input | Result |
|---|---|---|
| Lexical not editable, `contenteditable` on, nothing else | type `Z` | shown text changes, document does not |
| + `beforeinput` / `paste` / `cut` / `drop` cancelled | type, Enter, Backspace, Delete, Ctrl+B, Ctrl+X, Ctrl+V | nothing changes; each arrives as a cancelable event |
| same | Tab | focus moves to the next control |
| same | arrows, Shift+arrows, Ctrl+Right, Home/End, Ctrl+A | caret and selection move; Lexical's selection follows; Ctrl+A stays inside the editor |
| same | type while editable, go read-only, Ctrl+Z | `beforeinput` `historyUndo`, cancelable; nothing changes |
| same | composition, caret in text | **document changes and gains undo steps** — the mutation observer copies the composed text in |
| same | `document.execCommand('undo')` from script | **document changes**: no `beforeinput` fires for it |
| + mark-all-dirty update on `input`, not discrete | composition in text and in an empty paragraph; `execCommand('undo')` | nothing changes; shown text restored; caret moves to the start of its text run |
| + the same update, discrete | composition in an empty paragraph | document unchanged but a stray text node stays on screen |
| + blur on `compositionstart`, refocus on a timer | composition | nothing is written at all; caret kept |
| `contenteditable` off, `tabindex="0"` | ArrowRight, Shift+Right, Ctrl+A | caret does not move, selection does not grow, Ctrl+A selects the whole page |
| read-only on and off around a selection | Shift+Right, then type | selection kept through both switches; typing replaces it |
| `element.focus()` on the surface | no selection inside / a caret inside | caret at the document's start / caret kept |

jsdom, the real `MarkdownEditor` at `63a81117d`, its surface mounted as Lexical's root:

- A text node's `data` changed plus an `input` event puts `helloZ world` into `getValue()` of a read-only editor. With the mark-all-dirty update on `input`, the value, the node keys and types of a 33-text-node document, the DOM and the undo depth are unchanged and no `"change"` fires. The same update made discrete leaves a stray text node in the DOM.
- With table cells selected and the root focused, a `paste` event on `<body>` reaches `PASTE_COMMAND` and writes `PASTED` into a cell of a read-only editor.
- A subtree listener on the surface sees `beforeinput` before any listener on the root and can cancel it.
- An editable editor's `keydown` Enter and `paste`, dispatched as real DOM events, edit the document; the same events on a read-only editor change nothing and throw nothing.

---

## Notes

[^mechanism]: Two other designs were examined and rejected.
    *`contenteditable` off with a caret of our own.* Measured: in a focused element that is not editable, arrows do not move a caret, Shift+arrows do not grow a collapsed selection, and Ctrl+A selects the whole page. Every movement key, a drawn caret and select-all would have to be rebuilt, per platform.
    *Lexical left editable, with only a command guard.* Lexical then handles every key itself. One command, `KEY_DOWN_COMMAND`, carries movement keys and editing keys alike, so the guard would have to let it through, classify each command it fans out to, and trust every handler of an allowed command never to edit. A composition still reaches the document through the mutation observer either way.
    `setEditable(false)` is Lexical's own switch: in 0.49.0 every root listener except `click` and `copy` tests `editor.isEditable()` first (`addRootElementEvents`). It is kept as layer 1, and the other layers cover what it does not: the browser's own editing of an editable element, plugins that dispatch commands from their own DOM listeners, and the mutation observer.
    `CodeEditor` differs in one respect. CodeMirror reverts a DOM change itself when its state is read-only; Lexical does not, which is why layers 3 and 4 exist here.

[^native-nav]: `selectionchange` is registered on the document and is not behind the `isEditable()` test, so Lexical builds its selection from the browser's on every caret move and commits an update with no dirty nodes. The editor's `registerUpdateListener` callback runs `updateSelectionState()` on each. This is how mouse selection in a read-only editor reaches `"selectionstate"` today. Measured: each arrow press gives one update with zero dirty nodes, and Lexical's selection equals the browser's afterwards.

[^edit-intents]: `beforeinput` is the browser's announcement of every edit it is about to make to an editable element, and all its input types are cancelable except a composition's. Measured in Chromium: typing, Enter, Backspace, Delete and Ctrl+B (`formatBold`) each arrive as a cancelable `beforeinput`; cancelled, they change nothing. `paste`, `cut` and `drop` are also cancelled directly, so the clipboard is neither read nor written and a file dropped on the surface does not navigate the page. `keydown` needs no listener: Lexical ignores it while not editable, the browser's default for a movement key is the movement, and its default for an editing key is a `beforeinput`. Tab is measured to move focus on.
    `CodeEditor` hooks the same events for its feedback ([CodeEditor.ts:2289](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2289)); it has no need to cancel them, because CodeMirror refuses them itself.
    A `beforeinput` that is not cancelable is not reported, so a composition keystroke gives one `"readonlyedit"` (from `compositionstart`), not two.

[^restore]: Why each part is as it is.
    *Why it is needed.* `flushMutations` in Lexical 0.49.0 copies a changed DOM text into its node whenever no `textInput` event came in the last 100 ms, with no test of the editable flag. A composition update fires no `textInput`. Measured: with layers 1 and 3 only, composing `n` then `に` in a read-only editor changed the document twice and added two undo steps. A scripted `document.execCommand('undo')` did the same.
    *Why `input`.* It fires after the browser changed the DOM and before the mutation observer's callback, which is a microtask. The `Event` class dispatches from a window-level capture listener, so the surface's handler is the first script to run.
    *Why marking dirty works.* `$updateTextNodeFromDOMContent` starts with `node.isAttached() && (compositionEnd || !node.isDirty())`. The observer's callback joins the pending update, finds every text node dirty and takes nothing; the commit then rewrites each dirty node's DOM from the document.
    *Why not discrete.* A discrete update commits at once, and the commit disconnects the observer, which drops its pending records. Lexical then never removes a text node the browser added outside any Lexical node (measured: it stays on screen in an empty paragraph). Left to run, the observer removes it.
    *Why every text node.* The handler cannot know which node the browser touched. Text nodes are the only ones the observer copies from the DOM; added and removed nodes it reverts itself.
    *Why `HISTORY_MERGE_TAG`.* `@lexical/history` then merges the commit into the current entry and pushes nothing. Measured: the undo depth is unchanged.
    Rejected: `$fullReconcile()` in a discrete update (the same stray-node fault); `setRootElement(null)` then back (rebuilds the whole DOM and loses the caret and scroll position); `editor.setEditorState(saved)` (it commits the pending, already-changed state first, which fires `"change"` and pushes history).

[^caret-jump]: Lexical restores a text node with `firstChild.nodeValue = text`, and the DOM moves a range inside replaced data to its start. Lexical would write its own selection back, but only while editable. Measured: the caret was at offset 5 before a composition and at offset 0 of the same run after the restore; in an empty paragraph it did not move.
    Blurring the surface on `compositionstart` and refocusing it on a timer prevents the composition from writing anything, and the caret stays (measured). It was not taken: the blur leaves the surface's subtree, which closes a `Popover` in `"blur"` dismiss mode and trips a `Dialog`'s focus trap. Switching `contenteditable` off for the duration was measured too and let the second composition through. Briefly making Lexical editable for the restore's commit would let it write the caret back, at the price of an editable Lexical while a foreign `input` is still propagating.

[^guard]: Layer 1 does not cover plugins that dispatch from their own listeners. `@lexical/table`'s selection observer listens for `paste` on the document and, when table cells are selected and the root holds focus, dispatches `PASTE_COMMAND` without testing the editable flag (`LexicalTableSelectionHelpers.ts:793`). In a browser the root of a read-only editor cannot hold focus today, so the route is closed by accident; this plan makes the root focusable and so opens it. Measured under jsdom, where the root can be focused: the paste writes into the selected cell. The paste event's target is `<body>` there, so the surface's own `paste` listener does not see it.
    The guard refuses by command, not by route, so it also covers a dispatcher added later. `COMMAND_PRIORITY_BEFORE_CRITICAL` puts the listener at the front of the critical queue (`registerCommand` calls `addFront` for it), ahead of `registerRangeGuards`' listeners.
    The four allowed commands: `COPY_COMMAND` (Ctrl/Cmd+C must work), `CLICK_COMMAND` and `SELECTION_CHANGE_COMMAND` (Lexical dispatches both while not editable; their handlers set selections), `FOCUS_COMMAND` (registered by the table observer; it answers a question and edits nothing). Movement commands such as `KEY_ARROW_LEFT_COMMAND` are refused although their handlers only move the selection: nothing dispatches them while Lexical is not editable, and refusing what read-only does not need is the rule that cannot go stale.
    The lists are written out in production code rather than read from `editor._commands`, which is internal to Lexical. The test reads that field, where reaching into internals is already the practice (`lexicalOf`).

[^selection-owner]: Lexical's commit writes the DOM selection only under `editor._editable` (`LexicalUpdates.ts:714`), so `editor.focus()` on a read-only editor sets a selection in Lexical's state and neither focuses the root nor shows a caret. `Component.focus()` on the surface goes through `DOM.sink.focus`. Measured: focusing an editing host by script keeps a caret already inside it, and puts one at the document's start when there is none.
    `copy()` selects the enclosing word before copying. While read-only that selection would exist in Lexical only and disagree with the browser until the next caret move. Copying the text `$computeWordExpansion()` describes gives the same clipboard and leaves one selection. The word is then not highlighted after a Copy at a caret, which the docs state.
    `handleWysiwygContextMenu` still adopts the browser's selection into Lexical. That follows the browser and does not lead it.

[^content-editable]: The stack tip couples the two: read-only forces `contenteditable` off, and `setContentEditable(true)` is remembered until read-only lifts (review item A-15 of `markdown-editor-context-menu-caret`). That coupling existed so `setContentEditable(true)` could not make a read-only editor editable. Layers 1–4 now refuse edits whatever the attribute says, so the purpose is kept and the coupling is not needed. `setContentEditable(false)` stays the host's way to take the caret away altogether, read-only or not. None of the coupled behaviour was released.

[^feedback]: The stack tip refuses silently on the WYSIWYG surface, and the docs say so. With a caret in the editor a silent refusal reads as a hang, which is the reason `CodeEditor` has the wash. One public event also closes the gap the docs name: the source editor's `"readonlyedit"` was not reachable from outside.
    The wash is appended to `MarkdownEditor`'s own element, not to the surface: the surface is Lexical's root, and Lexical removes any child it did not create. `CodeEditor` appends its wash to its own element the same way, and ARCHITECTURE.md allows a non-interactive helper as a raw child. In source mode only the source editor's wash plays; the editor re-emits the event without flashing a second time.
    The helper is shared because the alternative is a second copy of the three constants and two methods. Its extraction changes nothing `CodeEditor` does; no test reads the two fields it replaces.
    Programmatic commands report too, as `CodeEditor.replaceRange` does. `MarkdownDocumentPanel`'s toolbar is disabled while read-only, so this is reached only from host code.

[^aria]: `aria-readonly` is only valid on a role that supports it, and a bare `contenteditable` `<div>` has none, so the role comes with it. CodeMirror writes `role="textbox"`, `aria-multiline="true"` and, when read-only, `aria-readonly="true"` on `.cm-content` (`@codemirror/view` `dist/index.js:8273–8280`); the two surfaces of one component should not differ. `getAria().setReadOnly` is how `ComboBox`, `Slider`, `AbstractBooleanInput` and `AbstractSelectableList` write it. `AriaRole` has no `'textbox'` and `Aria` no multiline setter; ARCHITECTURE.md says to extend `Aria.ts` when a setter is missing.
    Tab was measured to leave the editor while read-only. Lexical's table plugin, which moves Tab between cells, is behind layer 1.

[^links]: Neither state has link-opening code: there is no `CLICK_COMMAND` handler of the editor's own and no call that opens a URL. A browser does not follow an `<a>` inside an editable element on a plain click. One side effect follows: at the stack tip a read-only surface is not editable, so the browser treats a link in it as an ordinary link and follows it on a click (not measured). That was never documented. With the surface editable again a click places the caret.

[^derive-routes]: jsdom's `InputEvent` has no `getTargetRanges`, so Lexical decides `beforeinput` is unsupported and registers no listener for it. A browser has it, and `beforeinput` is the event layer 3 depends on, so the test adds it to the derived set. The framework's own listeners sit on `window` and are left out of the set by construction.
    The second derived list is the command list of case G1. Together they are how a later Lexical upgrade, or a plugin added to the editor, shows up as a failing test and not as an unlisted route.
