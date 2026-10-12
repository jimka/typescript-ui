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

*Corrected after the fourth review.* The attributes are written, and written only while the surface is `contenteditable`. What assistive technology is told is the browser's doing: Chromium reports the text box and that it is multi-line, and does not report an editing host as read-only whatever `aria-readonly` says. See *Accessibility* in the Implementation Notes.

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

---

## Implementation Notes

Implemented on `feature/markdown-editor-readonly-keyboard-selection`, branched from `feature/markdown-language-readonly-and-fences` at `a11d86be6`. That base is the tip of a stack of unmerged branches, nine of which changed files this plan edits after it was written, and the commit the plan's line numbers refer to (`63a81117d`) is not an ancestor of it. Every path, line number, snippet and expected row was therefore checked (at `a11d86be6`) against the code before a test was written. The plan's design stands: the surface stays `contenteditable` while read-only, and four layers refuse edits. The fourth works differently (difference 3), events the plan leaves alone are listened to after all (differences 8 and 9), and one non-goal is reversed for a read-only editor, on this run's brief (difference 8).

**Where the branch stands now.** On 2026-10-12 the orchestrator rebased the whole stack into one line. The branch no longer stands on `a11d86be6`, which is not an ancestor of it: it stands on `feature/spatial-navigation-redesign` (`d9874ae99`), with ten UI branches below it. Its own commits are `feature/spatial-navigation-redesign..HEAD`: the in-progress plan move, two code commits, two documentation commits, these notes, and the implemented plan move. "The base" in these notes is `a11d86be6`, where the base's behaviour was measured; `component/editor/` is byte-identical at `a11d86be6` and at `d9874ae99` (tree `6170b725e`), so what is said of the base's editor code holds for the new parent as well. *Verification* says what was run before the rebase and what on the final tip.

**The plan is closed on the owner's decision of 2026-10-12.** The review loop reached its cap of three rounds with two blocking findings in the code, which were fixed once. A fourth review, run from outside the loop, read those fixes: the take-out for compositions held, and it found three blocking points of its own, two in link following and one in what these notes claimed about assistive technology. A fifth review read the fourth round's fixes and found no code defect; its one blocking finding was in these notes (six statements that were false at the tip). All of it is fixed as *Changes made after the review* says. **The fixes of the final round, the one after the fifth review, have been read by no reviewer:** the owner decided that this round is the last and that the plan closes after it without another review.

Two functionalities are on the branch, each with its own code commit and documentation commit:

1. **A read-only editor's caret, and its refused edits**: the plan.
2. **A read-only editor follows its links**: not in the plan. It can be dropped by dropping its two commits.

### What a read-only WYSIWYG editor allows, and every route it refuses

Read from the code and run: the row ids are tests, "browser" is the Chromium run described under *Browser checks*.

| Allowed by keyboard | How | Pinned by |
|---|---|---|
| Focus: Tab into the editor, Tab and Shift+Tab out of it | the surface is an editing host, so a tab stop by itself; no key of a read-only editor takes Tab | S1, S6, R1 (`Tab`, Shift+`Tab` not cancelled); browser |
| Moving the caret: arrows, Home, End, PageUp, PageDown, Ctrl with them | the browser's own; Lexical follows the browser's selection | R1, R12; browser |
| Selecting: Shift with the movement keys, Ctrl/Cmd+A (the editor's text only) | the browser's own | R12, M2; browser |
| Copying: Ctrl/Cmd+C | Lexical's own copy handler, an allowed command | R9, G4; browser |
| The context menu: Shift+F10, the ContextMenu key; Copy only | unchanged code, now reachable | C9; browser |
| Following a link: Enter with the caret in it (functionality 2) | the Enter key, pressed alone, is taken at `keydown` wherever the selection state reports a link for the caret | L1, L10, L16, L17, L21, L22; browser |

| Route by which a change can arrive | Refused by | Signalled | Pinned by |
|---|---|---|---|
| Typing, Enter, Backspace, Delete, word and line deletion | layer 3: the cancelable `beforeinput` is cancelled | once | R2; browser |
| A paste, a cut and a drop, by key, by mouse or by a drag | layer 3: `paste`, `cut`, `drop` cancelled; the clipboard is neither read nor written | once | R4; browser (Ctrl+V, Ctrl+X, a drop of outside text, selected text dragged inside the editor) |
| The browser's format shortcuts, a spelling replacement, dragged text being moved out, an undo or redo the browser offers the surface from its own menu | layer 3: each is a cancelable `beforeinput` | once | R2 (`formatBold`, `insertReplacementText`, `deleteByDrag`, `historyUndo`, …); browser (Ctrl+B, Ctrl+I) |
| The undo and redo keys: Ctrl/Cmd+Z, Ctrl+Y, Ctrl/Cmd+Shift+Z, and Alt+Backspace with or without Shift, which a browser on Windows gives its own undo and redo | the surface stops the key (difference 9); `UNDO_COMMAND` and `REDO_COMMAND` are refused by layer 2 besides | no for the key; once for a dispatched command | R1, R16, K1, K2, G2; browser for the first three (the Alt pair acts on Windows only: a manual check) |
| A composition (IME input, a mobile keyboard) | not cancelable: layer 4 takes the view out when the browser announces the text (`beforeinput`) and renders it anew when the browser reports it (`input`); the document never takes it, whichever script hears of the change first | once for each step, at the `beforeinput` that announces its text (difference 13) | R3, R5–R8, R14, R17–R29; browser, 63 runs and the 20 of the third review |
| A script's `execCommand` on the editing host, or a script's write followed by an `input` event it sends | layer 4: Chromium fires no `beforeinput` for it, only `input`, on which the view is rendered anew | no | R6, R17, R21; browser |
| Any Lexical command that can edit, whoever dispatches it | layer 2: the guard | once | G1, G2, G5 |
| A paste the table plugin forwards from the document with cells selected | layer 2 | once | R13; browser |
| A key Lexical would act on (`keydown`), a composition's end, a drag over the surface | layer 1: Lexical is not editable | no | R1, R5, R10 |
| An editing command called from code or from a toolbar, `cut()`, `paste()`, unlinking | the public gate, before all four | once | C1, C2, C6, the read-only describe |
| A context-menu item | the menu holds Copy alone | no | C9; browser |
| `setContentEditable(true)` | changes nothing about read-only | — | S5, G5; browser |

Still allowed, on purpose: `setValue()`, `setMode()`, `markClean()`, `setReadOnly()` (C7, M4), and `copy()` (C8).

**Two routes stay open.** Both end in Lexical's mutation observer, which takes changed text into the document and asks neither whether the editor is editable nor what made the change. Row R15 pins both as known limits.

1. **Text written straight into the surface's elements with no event at all**: a script, a browser extension, a page translation. As on an editable editor, and as at the base. No key, paste, drop or composition writes text that way: each is announced by an event the surface hears before the browser changes anything.
2. **A key's or a composition's edit, where another script hides the announcement from the surface and hears the report first.** The condition is exact: a capture listener on the window, registered before the framework's, that stops `beforeinput` from going further (`stopImmediatePropagation`), together with a listener for `input` there. The surface then neither cancels the edit nor takes the view out, and at `input` the other listener's turn lets the observer in before the surface hears of the change. Measured in Chromium with real keys (the fourth review's probe, `browser/r4/p2-swallow.mjs`): Backspace made `first…` into `frst…`, a composition made it `finにrst…`, `"change"` fired and the editor was dirty. With the first listener alone the document is unchanged (the surface is the first to hear `input` and renders the view anew), and with the second alone it is too (the edit is cancelled, or the view is out). A typed letter is not taken in either case: Lexical's observer passes over a text change that follows a `textInput` event, which typing sends.

Rendering the view anew at `input` cannot cover the second: by the time the surface hears `input` the observer has written the change into the editor's state and the update has gone to every listener, so what would be rendered is the changed document. Closing it means either being ahead of the observer, which is a mutation observer of the framework's own created before Lexical's, or taking the change back out of the editor's state, which would send a second `"change"` and leave a step in the undo history. Neither was done; see *Decisions that await the user's sign-off*.

A script's own `execCommand`, and a script's write followed by an `input` event it dispatches, are put back even with a listener ahead (measured in Chromium): the listeners of an event dispatched from running script get no turn for microtasks between them.

### Differences from the plan

1. **Line numbers.** Each edit was placed by the symbol the plan names. The last column is the final tip's.

   | Place | Plan (`63a81117d`) | At the base | After this branch |
   |---|---|---|---|
   | `MarkdownEditorEvent` | 261 | 272 | 280 |
   | `registerRangeGuards`; `$computeWordExpansion` | 2745; 2834 | 4020; 4110 | 4029; 4119 |
   | `WysiwygSurface`; its constructor | 3614; 3633 | 5270; 5289 | 5331; 5360 |
   | `commandApplies`; `refocusSurface` | 4067; 4089 | 5723; 5745 | 6186; 6530 |
   | `readActiveSelectionState`; `setReadOnly`; `focus` | 4283; 4375; 4403 | 5937; 6029; 6057 | 6728; 6827; 6858 |
   | `toggleLink`; `copy` (the plan's `copyWysiwygSelection`); `cut`; `paste` | 4792; 4965; 5016; 5058 | 6460; 6611; 6673; 6715 | 7263; 7419; 7495; 7537 |
   | `setContentEditable`; `destructor`; `buildEditor`; `mountWysiwyg` | 5786; 5820; 5871; 5923 | 7460; 7494; 7545; 7601 | 8311; 8335; 8393; 8451 |
   | `CodeEditor.ts`: the flash constants; the two fields; `mountFlashOverlay`; `flashReadOnly`; the destructor's lines | 346–356; 493–497; 2778; 2854; 1894 | 346–356; 623–627; 2934; 3027; 2051 | gone (one constant at 352); 619; 2925; 3000; 2043 |
   | the describe the S rows replace; the read-only describe, in `markdown-editor.test.ts` | 359–425; 5738 | 359–425; 6210 | 359–472; 6553 |

2. **`copyWysiwygSelection` does not exist here.** It is on `feature/markdown-editor-raw-block-range-edits`, which is not below this branch. The plan's three changes (the `readOnly` test, the `expansion` branch, the `refocusSurface()` call) went into `copy()` itself, around the `copied` line as the base has it.

3. **Layer 4 renders the view anew; it marks nothing dirty.** The plan's `input` handler runs `editor.update($markAllTextDirty, { tag: HISTORY_MERGE_TAG })`. That does not hold on this stack, for two reasons found one after the other, and what replaced it was itself replaced once.

   *Marking text dirty rewrites documents.* It runs every rule the editor registers for a changed node, and the root's rules with them. A document that was loaded and never edited is not in the form those rules leave: they are what rewrites a raw block into its saved form at the first edit. The plan names this risk ("They must leave a settled document alone") and treats a failure as the rule's defect. A probe over the round-trip corpus, 3,256 runs (each of 492 documents at every text node's start and end), found the update changing 11 of them, in two documents: `> a\n<div` saved as `> a\n\n<div` and fired `"change"`, and a tab-indented definition in a list item had its nodes replaced. Those rules are the raw block plans' and are being changed on the branch that is not below this one, so they were not touched.

   *Repairing text node by text node is not enough.* The first replacement had every text node rewrite its own DOM from the document, through the node's `updateDOM`. It held for a composition at a caret, and over the corpus under jsdom. The second review broke it in Chromium with real keys: a composition over a selection that starts where a formatted run begins. The browser then removes the run, splits the text before it, and moves the node it composes in into a wrapper of its own inside the text element before it; Lexical's observer resolves the moved node to that element's text node and copies the composed text into the document (`start **bold** mid tail` became `n**bold** mid tail`). No repair of single nodes covers every such shape.

   *Rendering the view anew once the browser reports its change is not enough either.* The second replacement did that: on `input`, the view was taken out and mounted again. It held in every run of this branch, and the third review broke it: Lexical's observer is told of a change in a microtask, and a browser runs the microtasks waiting after each listener of an event. With another script's listener on the window ahead of the framework's, a host's or one a browser extension put there from its own world, the observer copied the composed text into the document before the surface heard of the change (`first paragraph` became `finにrst paragraph`, and `"change"` fired twice). The plan's footnote on the restore assumes the surface's handler is the first script to run after the browser's change. It is not, there.

   *What is there now.* The view is rendered anew, whole, in two steps around the browser's change.

   - **Before the change.** A `beforeinput` that cannot be cancelled is the browser's announcement of an edit it will make whatever the page says: a composition's text. The surface reports it (`"unpreventableedit"`) and `takeOutView()` takes the editor's view out of the surface (`WysiwygSurface.takeOutView`): Lexical drops every element it rendered and, with them, its mutation observer. Nothing has changed yet, so there is nothing for any listener's turn to hand the observer. The browser then writes into a surface the editor is not looking at.
   - **After it.** On `input`, `restoreView()` puts the view back (`WysiwygSurface.putBackView`): Lexical empties the surface of what the browser wrote and builds its elements from the document. A change that arrives with `input` and no announcement finds the view in place; it is taken out and put back there in one go (`WysiwygSurface.remount`), which is the second replacement, kept for that case.

   No update runs, no node is marked changed, no rule runs. The announcement, the browser's change and its report are one task, so the surface is never painted without the view (measured: no frame in the 20 compositions of the third review's check). A task later (`finishViewRestore`) a view that is still out is put back, for an edit announced and never made, and the selection the editor held is written back to the browser, and the surface's scroll offsets with it: the browser's selection goes with the elements, and the browser sets one of its own once the event is over, so writing it in the event itself does not last (seen in Chromium: the caret ended at the document's start and the view scrolled there). Lexical writes its selection only while editable, so it is editable for that one update, three calls in a row with no event between. The write is skipped where the surface does not hold the keyboard, since a browser focuses an editing host a selection is set in, and where the selection's nodes are gone.

   While a restore waits, the editor emits no `"selectionstate"`. Its selection is, for that task, the one the browser set in the surface rendered anew, and a host's toolbar flipped away and back with every refused keystroke (the third review: `plain` then `bold` for a caret in bold text). The state is compared once when the restore is done; with the selection written back it is the one last reported, and nothing is emitted (row R27).

   The rule is closed by construction, twice over. Whatever the browser did under the surface, what is shown afterwards is what Lexical renders for the document; and for an edit the browser announces, Lexical is not there to see it. Rows R17 take twelve shapes of damage, the one the second review found among them; R18 to R21 pin the task's half; R22 to R26 pin the take-out (for either order of listeners; with no `input` following; only for a `beforeinput` that cannot be cancelled, on a read-only editor; once for a burst; and harmlessly when the document, read-only or the editor went while the view was out); R14 and R6 pin that no rule runs. In Chromium, 63 compositions left the document, the shown HTML and the dirty flag as they were, and the 20 of the third review's check did with a listener of another script ahead on the window, on the document, in an extension's world, or nowhere (see *Browser checks*); the caret, or the selected text, and the scroll offset were where they had been.

   *The second half runs in the frame about to be painted, or in a task, whichever comes first.* It was a task alone. The fourth review asked for a check that nothing is painted at the offset the browser scrolls to in between, on a surface that is really scrolled. Something was: the browser scrolls the surface to the selection it sets at the document's start, and a frame came before the task in every run of a probe that asked for one (`browser/r4/reveal-timing.mjs`), so the document's start showed for one frame per refused keystroke. A frame's callbacks run before the frame is painted and after the event, so the restore is also requested for the next frame, and whichever of the two comes first calls the other off (row R29). After that, 13 runs on a scrolled text document painted one offset only. With images in the document the surface is for a moment shorter than it was, until the images of the view rendered anew are laid out, and the offset cannot be held: one of six runs with images served uncacheable painted a frame at an offset near the top; four runs with cacheable images painted none. That is a limit of rendering the view anew.

   *Lexical is made editable for the one update that writes the selection.* The fourth review pointed at `$updateDOMSelection`, which Lexical 0.49 exports and which writes a selection to the browser without that. It was tried, and works: every row and the browser checks pass with it. It was not kept. The function has to be handed the browser's live `Selection`, and the DOM seam hands that out on its read side only (`DOM.source.readDocumentSelection`, "the read-side named escape"); writing through it breaks the seam's one-way contract, and a write-side twin is a new member of the seam for one call. With the flip, Lexical writes the selection itself from inside its own commit, into the region `mountView` gave it. Nothing listens for Lexical's editable state in the editor, and no event is handled between the three calls. Listed for sign-off (decision 2).

   Four things follow. The plan's limit "the caret moves to the start of its text run" is gone: the caret stays. Each keystroke of a composition still starts a new one, since rendering the view anew ends it, so each is reported and flashes. A refused composition costs a render of the whole view per keystroke. And with whole table cells selected the browser's caret is not put back, Lexical writing no browser selection for a selection of cells: the cells stay selected and the document unchanged (row R28, a known limit, and in the docs). `HISTORY_MERGE_TAG` is on the selection write only. The plan's mutation row "`restoreShownText` passes `{ discrete: true }`" has no counterpart; the mutation table has what replaced it.

4. **The two command lists are typed `readonly AnyLexicalCommand[]`,** Lexical's own type for a command of any payload. The plan's `readonly LexicalCommand<unknown>[]` does not compile: a `LexicalCommand` is invariant in its payload. The lists themselves are the plan's: the stack registers the same 50 commands (rows G1 and R0 were derived first, on the base). Functionality 2 adds no command listener.

5. **The guard is registered last in `buildEditor`,** behind the update listener, with a comment: a listener registered later at `COMMAND_PRIORITY_BEFORE_CRITICAL` goes in front. Nothing this editor registers uses that priority, its own handlers and the Lexical plugins it sets up alike. One installed package does: `@lexical/extension`, in `NormalizeTripleClickSelectionExtension`, which this editor does not register.

6. **`focus()` goes through `refocusSurface(preventScroll)`,** which holds the one read-only test for both. The plan's grep therefore finds `getReadOnly()` in `refuseIfReadOnly`, `refocusSurface`, `readActiveSelectionState`, `copy`, `buildContextMenuItems`, `finishViewRestore` and the guard's callback in `buildEditor`, and not in `focus`. A read-only `focus()` does not build the Lexical editor.

7. **The surface's `"readonlyedit"` has no payload,** as planned. Until the fourth review it carried the kind of edit refused, for functionality 2 to pick Enter's paragraph break out; Enter is now decided by the key (difference 8).

8. **A read-only editor follows its links** (functionality 2). The plan's non-goal "Opening links" is reversed for a read-only editor. The reason is what the base does, measured in Chromium: its read-only surface is not editable, so the browser treats a link in it as an ordinary one. The link is a tab stop, and a click or Enter on it navigates the whole page away, in the same tab. With the surface editable again a browser follows no link in it, so the plan as written leaves a read-only editor's links dead. This run's brief lists following a link by keyboard among the things that must work.

   Three rules, each closed over its shapes:

   - **Enter.** The key is decided at `keydown`, by the key and not by the edit the browser would announce for it. Where Enter is pressed alone on the read-only surface as the editing host, the surface reports it (`"readonlyenter"`), and the editor asks the selection state: for a caret, `$readSelectionState().linkUrl`, the function that computes the `linkUrl` a host sees. Where that reports a link whose address is one to open, the editor cancels the key and opens the link; the browser then announces no edit. Anywhere else the key is left alone and becomes the refused edit Enter always was. So Enter follows a link at exactly the caret places where `linkUrl` reports one, by construction (rows L17 and L21: every caret place of eight documents, 18 places around a link in Chromium).

     The first three versions decided at `beforeinput`, on the `insertParagraph` the key gives. The fourth review showed that the kind of edit does not say Enter was pressed: beside an image inside a link Chromium announces `insertLineBreak`, so in `[![build](a.svg)](x) [![docs](b.svg)](y)` three caret places reported a link and Enter followed at one, and the second badge could not be opened by keyboard at all. It also showed the converse: any `insertParagraph` at a caret in a link opened it, whatever produced it. A paragraph break or a line break that reaches `beforeinput` is now a refused edit like any other (row L4).

     | Key, the caret in a link | What happens | Row |
     |---|---|---|
     | Enter | the link opens; the key is cancelled, no edit is announced, nothing is reported | L1, L21; browser |
     | Enter, text selected | a refused edit: a link is followed from a caret | L3 |
     | Enter in a link whose address is not opened | a refused edit | L9, L18 |
     | Shift+Enter | left to the browser, which announces a line break: a refused edit | L22; browser |
     | Ctrl+Enter, Alt+Enter, Cmd+Enter | not taken by the editor: no link is followed, and the key is left to the browser. What the browser then does is its own: Chromium on Linux announces no edit for Ctrl+Enter or Alt+Enter, so nothing happens; a browser that announces one gets the refused edit like any other, which flashes (row L22 models that browser). Cmd+Enter and any key on macOS or Windows were not run in a browser | L22; browser (Ctrl, Alt, Shift in Chromium on Linux only) |
     | Enter held down | the first `keydown` follows the link (or is the refused edit, outside one); the repeats are stopped, so nothing opens again and nothing flashes | L16; browser |
     | Enter while an input method composes | left to the input method | L22 |
     | Enter with the surface not `contenteditable` | not taken: there is no caret, the key goes to a focused link, and the browser makes a click of it, which the editor follows | L13, L22 |
     | Enter in an editable editor | never taken | L8, L22 |

   - **A click.** In a read-only editor a click on a link is the editor's alone: its default is cancelled, and the editor follows the link where the click asks for that. One rule decides it: **a run of clicks follows its link at most once, and that is on its first click.** A browser counts the clicks of a run in `detail`: 1 for a single click and for the first of a double click, a triple click and every longer run, then 2, 3 and so on; 0 for a click no pointer made.

     - A later click of a run (`detail` 2 and up) never follows, whatever is selected and however long the run.
     - The first click follows unless it selected text itself: unless it left text selected that was not selected before the press, which is the end of a drag over text, or a Shift+click. The surface reports a press (`mousedown`, any button) while read-only, the editor notes what the browser has selected then, and compares at the click. Text selected before the press and still selected was not selected by the click, so a single click on a link's word that is selected already, or on a link in a document selected with Ctrl+A, follows (a browser leaves a selection standing until a click inside it is over).
     - A click no pointer made (`detail` 0: the click a browser makes of Enter on a focused link, where the surface is not an editing host) follows.

     It is the first click that follows because a click is reported when it happens: whether another follows is known only once the double-click interval has passed, and a link that opened that much later on every click would be the worse of the two. Where no press was seen for a first click, any text selected counts as the click's, which is the choice that never opens a link twice. The surface passes a `click`, and an `auxclick` of the middle button, on to the editor while it is read-only. A click beside a link is left alone, and so is every click in an editable editor.

     | Click on a link, read-only | Followed | Default cancelled | Row |
     |---|---|---|---|
     | a single click; the first click of any run | yes, unless it selected text | yes | L5, L6, L19 |
     | the second click of a run and every later one, up to the eighth in the rows | no | yes | L6, L19 |
     | a first click that left text selected that was not selected before the press: a drag inside the link, into it, out of it or around it, a Shift+click | no | yes | L6, L12 |
     | a first click with text selected before the press and still selected: a word of the link, its whole text, its block, everything | yes | yes | L6, L20 |
     | the browser's caret placed, Lexical not yet told | yes | yes | L12 |
     | a click no pointer made, whatever is selected, the link's own text included | yes, once | yes | L6, L13 |
     | the surface not `contenteditable`: by mouse, or by Enter on the focused link | yes, once | yes | L13 |
     | a middle click, the surface `contenteditable` or not | as a click | yes | L6, L15, L19 |
     | a click with the secondary button | no | no | L15 |
     | an address that is not opened, an empty one among them | no | yes | L9, L18 |
     | a click beside the link | no | no | L7 |
     | an editable editor, `contenteditable` or not, any button | no | no | L8, L14, L15 |

     Row L6 runs the rule over every pair of 17 selections, before the press and at the click, and over each with no press seen, for `detail` 0 to 8 and both buttons, on an `http` link and on a `mailto` one: 11,016 clicks. Row L19 sends runs of one to eight clicks as a browser does, with the selections a browser leaves after each.

     The rule went through four versions, each closing what the review before it found. The first two looked at the selection alone, for an end of it in the link; a triple click opened the link twice, the block the third click selects enclosing the link with neither end in it (the third review). The third compared the selection at the click with the one before the press, and held for one, two and three clicks; from the fourth click on, the browser selects the same block again, the two selections are equal, and the rule read that as text selected already: four clicks opened the link twice and five three times (the fourth review). A rule that reasons about the selection across a run leaks wherever two clicks of the run leave the same selection. The count of the click does not: it is the browser's own, and it is what makes a later click of a run a later click.

     The default is cancelled whether the link is then followed or not. Where the host has turned `contenteditable` off, a browser follows the `<a>` itself: a click in the same tab, a middle click in a new one, and both to the address on the element. The first version did not cancel a click, so the link opened twice and the page left (the first review); the second handled the click through Lexical's `CLICK_COMMAND`, which is not dispatched for a middle click (the second review).
   - **The address** is the one the link was written with, which `linkUrl` reports and the viewer opens. It is followed when it is relative (it holds no `:`) or starts with `http:`, `https:`, `mailto:`, `tel:` or `sms:`, whatever the case; `resolveImageSpec` tests an image's the same way, in the case written. These are the schemes Lexical's own link node lets through to a link's element; a link can be written with others (`ftp:` in an autolink), and such a link is not followed. Neither is a link whose address is empty or white space alone: `[here]()` is a link, and a browser resolves its address to the page the editor is on, which Enter or a click then opened in a new tab (the third review; row L18). The test is strict where a browser is lenient: a browser drops a tab from an address before it reads the scheme, so `java<tab>script:` is a script address to it, and is refused here for holding a `:` behind no allowed scheme. The first version took the address from `LinkNode.sanitizeUrl`, which is what the link's element holds as `href`; that rewrites `other.md` to `https://other.md`, a different host (the first review). Rows L9, L10 and L18 enumerate the forms.

   A press and a click read the browser's selection (`DOM.source.readDocumentSelection`), not Lexical's, which hears of what a press and a drag selected after the click; Enter reads the editor's own, which a key press finds up to date. The link opens in a new tab with `rel="noopener noreferrer"`, as a link of the `Markdown` viewer does by default, through a temporary anchor that is clicked and removed: `TableExporter.download` starts its download the same way.

9. **The surface listens for `keydown`, for the undo and redo keys alone.** The plan's table has "`keydown` … not listened to", on the reasoning that the browser's default for an editing key is a `beforeinput`, which the surface cancels. That holds for the undo key only when the browser has an undo of the surface's own to offer. Its undo is the page's: with nothing of the surface's on it, Ctrl+Z pressed in the read-only editor took back the last edit made in another field of the page and moved the focus there (seen in Chromium). An editable editor never lets it run, Lexical taking the key. A read-only surface now stops Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y at `keydown`, without a report, which is what a read-only `CodeEditor` does with them. Row R16, and five variants of R1. Alt+Backspace and Alt+Shift+Backspace are stopped with them on every keyboard but an Apple one: Blink's key table for Windows maps the pair to the browser's undo and redo (the fourth review), and on an Apple keyboard Option+Backspace deletes a word, an edit the surface refuses as one (rows K1, K2). They act as undo on Windows only, so that they do is a manual check there. With functionality 2 the same listener decides Enter and stops a held Enter's repeats (difference 8), and the surface also listens for `mousedown`, `click` and `auxclick`.

10. **Rows.** No id of the plan was renumbered. Added, with the next free number of their series:

    | Row | What it pins | Why |
    |---|---|---|
    | S6, S7 (mounted) | the attributes on the real element | the unit rows read the recorded writes |
    | G5 | `setContentEditable(true)` lifts nothing | the user's decision of 2026-10-10 |
    | R14 (four documents); R6's last assertion | the restore runs none of the editor's rules | difference 3 |
    | R17 (twelve shapes, and one on an editable editor), R18–R21 | whatever the browser did to the surface, the view is rendered anew; the selection comes back, once for a burst, only with the focus, and harmlessly when the document, read-only or the editor went meanwhile | difference 3 |
    | R22 (two orders of listeners), R23–R26 | an edit that cannot be cancelled finds the view out of the surface, whichever script hears of the change first; the view is back a task later where no change follows; nothing but such a `beforeinput` on a read-only editor takes it out; a burst is one restore; nothing breaks when the document, read-only or the editor goes while it is out | difference 3, the third review |
    | R27 | no `"selectionstate"` while a restore waits; one where the selection is not written back | the third review |
    | R28 | with table cells selected: the cells stay selected, the document unchanged | a known limit, stated |
    | R15 | the route that stays open, and the one shape in which the order of listeners still counts | so that both are stated, and fail when closed |
    | R16 | the undo and redo keys | difference 9 |
    | R13 on an editable editor | the control for R13 | the plan states it in a footnote |
    | "every block kind", 19 documents | every route and every refused command, on a document of each kind of block, with the shown text changed under each text node and a node added to each block | the brief's read-only sweep |
    | C8, C9 | `copy()` and the menu's Copy are not reported | |
    | F8 | `copy()` over a table edge copies the same read-only | the `expansion` branch sits in front of that code |
    | M5 | the wash is mounted on the editor, outside the surface | |
    | M6 | `focus()` focuses the surface | F1 with a real element |
    | S8, S9 | the surface is a text box exactly while it is an editing host: the four states of read-only and `contenteditable`, on the real element and in the recorded writes | the fourth review |
    | R29 | the restore is finished in the frame about to be painted or in a task, whichever comes first, and once | the fourth review's check of a scrolled surface |
    | L1–L22 | functionality 2. L6 is the click-run rule over every pair of selections, `detail` 0 to 8, both buttons and two addresses; L18 the empty address; L19 runs of one to eight clicks; L20 text selected already; L21 Enter at every caret place of eight documents; L22 Enter with a modifier, while composing, and with no editing host | |
    | K0–K2, in a file of their own | the undo and redo keys of an Apple keyboard | Lexical decides once, as it is loaded, whether the keyboard is an Apple one; the file gives the platform before anything is loaded |

    G1 also asserts that neither list holds a command the editor has no handler for; it counts listeners, the guard's own being one of a refused command's.

    Five things differ in the harness. The mounted surface is given the focus, as it has whenever a key or a composition reaches it, and `Range.getBoundingClientRect` is stubbed, since Lexical measures a caret it writes into a focused root. `settle()` lets one task run after the microtasks, as a browser has by the next event: the selection is written back in a task. `selectIn` sends the `selectionchange` a browser sends after Lexical writes a selection; jsdom sends none, and Lexical then passes over the next real one. M6 cannot assert that the caret is kept: jsdom collapses the selection on every `focus()`, so that is a browser check. G3 runs with a range selected, since jsdom has no `Selection.modify`, and treats `CLEAR_EDITOR_COMMAND` as it treats `CLEAR_HISTORY_COMMAND`: the history's listener is the only one the editor has for it.

    The red phase: with the new modules and tests in place and `MarkdownEditor.ts` as at the base, 100 tests failed. The link rows and R16 were written with their code, R17 after the second review and R22 to R28, L6 and L18 to L20 after the third, each with the code that passes it: the mutation table below shows each failing without it, R17 for the node-by-node repair among them.

    Two things about the rows of the third review. A browser gives every mutation observer a turn after each listener of an event it dispatches; jsdom, where the test dispatches the event from running script, gives none. Row R22 therefore takes the turn itself, between the browser's change and the `input` event, which is what a listener ahead of the framework's amounts to. And its browser writes where a browser would: in the text node the caret was in while that node is still shown, in the surface itself once it is not.

    Two things jsdom cannot show are browser checks: that the scroll offsets are kept (jsdom keeps an offset whatever happens to the content), and that the selection write takes no focus (jsdom moves no focus for a selection).

11. **Docs.** The Read-only section says more than the plan lists: what is reported and what is refused quietly, on each surface; that Tab leaves from a table cell; the table limit as it was measured; the open route of R15. The changelog's "Fixed" entry also says that Ctrl/Cmd+X is now refused and that the undo and redo keys are stopped. `docs/concepts/accessibility.md` gained the editor's role in its table. Functionality 2 has a subsection, the last of the Read-only section, and an "Added" entry of its own.

12. **Commits.** Shared files were edited in the commit of the functionality they belong to, as the commit rules require. The plan file's frontmatter lists `markdown-editor-list-item-block-paste` as the dependency, which is implemented below.

13. **A composition is reported where the browser announces its text, not where it starts.** The plan reports at `compositionstart` and leaves a `beforeinput` that cannot be cancelled unreported, so that a composition keystroke gives one `"readonlyedit"`. The surface now listens for no `compositionstart`: the `beforeinput` that cannot be cancelled is both the report and the signal to take the view out. The count is the same, one for each step, since rendering the view anew ends the composition and each step starts a new one. What changes is a composition that starts with no text to write. An on-screen keyboard starts one around the word a tap puts the caret in, and reported at its start that would flash on a tap (the fourth review; it cannot be run here, see *Browser checks*). The refusal is not weakened: it acts on `beforeinput` and `input`, as before. A `compositionstart` is now one of the events that changes nothing and reports nothing (rows R1, R24), and row R22 pins the report.

14. **The surface is a text box only while it is an editing host.** The plan writes the role and its two properties always. With `setContentEditable(false)` the surface takes no focus and has no caret, and it still said `textbox`, with `settable: true` in Chromium's accessibility tree for an editable editor (the fourth review). It now carries `role="textbox"`, `aria-multiline` and `aria-readonly` while it is `contenteditable` and none of the three while it is not (`WysiwygSurface.applyTextBoxState`; rows S8 and S9; the measured tree is under *Accessibility*). For that, `Aria.setReadOnly` and `Aria.setMultiline` take `null` to remove their attribute, as `Aria.setHidden` does.

### The two surfaces compared

| | WYSIWYG, read-only | Source (`CodeEditor`), read-only | Why they differ |
|---|---|---|---|
| Caret, keyboard selection, copy, tab stop | yes | yes | |
| Typing, Enter, a paste, a drop, a composition | refused, event and flash | refused, event and flash | |
| Backspace, Delete | refused, event and flash | refused, event and flash | |
| The undo and redo keys | stopped, quiet | stopped, quiet | |
| Tab, Shift+Tab | move focus on, quiet | move focus on, quiet | |
| A command from code | refused, event and flash | refused, event and flash | |
| `setValue`, a mode switch | allowed | allowed | |
| The cut key | refused, event and flash; the clipboard is left alone | copies the selection, removes nothing, quiet | CodeMirror's own cut handler copies; the plan keeps `CodeEditor` as it is. `cut()` from code is refused on both |
| Format keys (Ctrl/Cmd+B, +I, +U) | refused, event and flash | not bound | |
| The floor under all of it | Lexical not editable, the command guard, the cancelled edit intents, the view taken out for an edit that cannot be cancelled and rendered anew after it | one transaction filter | CodeMirror refuses a change in its state; Lexical has no such hook, and its mutation observer takes changed text whatever the editable flag says |
| Which wash plays | the editor's own, over the WYSIWYG surface | the source editor's own | one refusal, one flash: the editor passes the source editor's event on and plays nothing (C4) |
| A link | followed on Enter and on a click | text | |

### Accessibility

**What is written.** While it is `contenteditable` the WYSIWYG surface carries `role="textbox"`, `aria-multiline="true"` and `aria-readonly`, which follows the read-only state (`"false"` while editable), through `getAria()`. These are the attributes CodeMirror writes on the source surface's content. No `tabindex` is written. While it is not `contenteditable` it carries none of the three (difference 14).

**What Chromium tells assistive technology**, measured in its accessibility tree through the debugging protocol (`Accessibility.getPartialAXTree`; `browser/r4/ax-options.mjs`, `ax-ceoff.mjs`), in the four states:

| Read-only | `contenteditable` | Attributes on the surface | Chromium's tree |
|---|---|---|---|
| no | on | `role="textbox"`, `aria-multiline="true"`, `aria-readonly="false"` | `textbox`, `multiline: true`, `editable: "richtext"`, `settable: true`, `readonly: false`, focusable |
| yes | on | the same, with `aria-readonly="true"` | **the same as the row above**: `readonly: false`, `editable: "richtext"`, `settable: true` |
| yes | off | none of the three | `generic`, no properties; `focus()` takes no focus; a link inside is a `link`, focusable, and a heading a `heading` |
| no | off | none of the three | the same as the row above |

**The read-only state does not reach Chromium's accessibility tree.** Chromium does not honour `aria-readonly` on an editing host: a bare `<div role="textbox" aria-readonly="true" contenteditable>` reads the same, and so does CodeMirror's `.cm-content` on the read-only source surface (`readonly: false`, `editable: "plaintext"`). The same element with a `tabindex` and no `contenteditable` reads `readonly: true`, which is the surface this plan replaced: it has no caret. An earlier version of these notes said that a screen reader user is told "edit, multi-line, read-only". That was not measured and is withdrawn. What the tree says is that the field is an editable multi-line text box; a screen reader user in Chromium may therefore meet a field announced as editable that takes no typing, with nothing but the flash, which is visual, to say why. No screen reader was run, so what one says in any browser is not known. `aria-readonly` is kept: it is the right attribute, and a browser that honours it on an editing host will pass it on.

The gap was not closed in code. Every way of closing it that was measured needs a user-facing string, and the library has no table of built-in strings yet; the options, with what the tree shows for each, are under *Decisions that await the user's sign-off* (decision 13).

Not done, and outside the plan: the text box has no accessible name, and a host cannot give it one, the surface being private (`MarkdownEditor.getAria()` names the outer element, which has no role). Nothing is announced for a refused edit; `"readonlyedit"` is the hook for a host that wants to say something by means of its own.

**Manual checks that were not run:** a screen reader (none is installed), Firefox and WebKit (neither is installed). The separate, unmerged ARIA branches are not depended on.

### Focus, Tab and the arrow keys

Read from `FocusTraversal`, `SpatialNavigation`, `Focusable` and `Dialog`, then run in Chromium.

- **Tab and Shift+Tab leave the editor**, from prose and from a table cell: Lexical ignores the key while not editable, so the browser moves focus. An editable editor keeps Tab only inside a table. `setTabKeyOwner(true)` stays, as the plan's non-goal has it, so `FocusTraversal` and a `Dialog`'s trap stand down for the key and the browser's own order applies, as for an editable editor outside a table and for a read-only `CodeEditor`.
- **The arrow keys are the caret's.** At the first line Up and Left leave the caret where it is, and at the last line Down and Right do: focus does not leave, and nothing is trapped, Tab being free. `isTextEntryElement` is true for the surface in both states, so a `ToolBar` leaves the arrows to it.
- **Spatial navigation** is on Ctrl+Alt with an arrow, which the editor does not take: from a read-only editor it moves to the neighbouring component, as from an editable one.
- **In a modal `Dialog`** a read-only editor behaves as an editable one: Tab cycles inside the dialog, and the first Escape releases the editor for one Tab.

### What changes for an existing read-only editor

Against the base (`a11d86be6`, the stack's tip at the time, never released), where a read-only surface is not `contenteditable`:

| At the base | Now |
|---|---|
| not a tab stop, no caret, arrows do nothing, Ctrl/Cmd+A selects the whole page | a tab stop with a caret, keyboard movement and selection; Ctrl/Cmd+A selects the editor's text |
| a `Dialog` whose content starts with one gives its initial focus to the primary button | the editor takes the initial focus, so Enter no longer presses that button; and the first Escape releases the editor instead of closing the dialog |
| a link is a tab stop, and a click or Enter on it navigates the page away in the same tab, to the address Lexical puts on the element (`https://other.md` for `other.md`) | the link is reached with the caret; Enter or a click opens it in a new tab, at the address as written (functionality 2; without it the link does nothing) |
| a refused command is silent | it fires `"readonlyedit"` and flashes |
| `getContentEditable()` is `false`; `setContentEditable(true)` is remembered until read-only lifts | `true`; `setContentEditable` acts at once and changes nothing about read-only |
| no role | `role="textbox"`, `aria-multiline`, `aria-readonly`, while the surface is `contenteditable`; none after `setContentEditable(false)`, as at the base. Chromium does not pass the read-only state on (see *Accessibility*) |
| `isTextEntryElement` is false for the surface | true: a host shortcut that stands down in a text field stands down here |
| no spelling marks, no on-screen keyboard | both, as on an editable surface (the plan's non-goals) |

Against 0.10.0, where a read-only surface was `contenteditable` and the browser edited its shown text: it was already a tab stop with a caret, so focus order does not change for a released consumer. What changes there is that nothing on screen can be edited, that Ctrl/Cmd+X no longer removes the shown selection, that the undo and redo keys do nothing, the event and the flash, the role, and that a link is followed. The migration note covers the one case where code must act: a command called on a read-only editor is no longer silent.

**Consumers that were read.** No `MarkdownEditor` is constructed or switched read-only in the library's demo (before this branch's toggle), the docs app, the QA panels or SQLAdmin's `frontend/src`: SQLAdmin's `DocumentationPanel` is an editable `MarkdownDocumentPanel`, and its three read-only editors are `CodeEditor`s. Those keep their behaviour: only the wash's code moved (`code-editor.test.ts` and the mounted read-only file pass unchanged). SQLAdmin was read, not run or changed.

### Regions of `MarkdownEditor.ts` touched

For the rebase of `feature/markdown-editor-raw-block-range-edits`. The line numbers are the final tip's. Nothing between lines 330 and 5254 changed, which is where range removal and the wrapper around Lexical's Markdown shortcut listener are.

| Lines (now) | What |
|---|---|
| 5, 32, 72–75 | imports |
| 277–329 | `MarkdownEditorEvent`, the `listeners` option |
| 5255–5833 | three constants, `$linkUrlToFollowAtCaret`, `WysiwygSurface` |
| 5997–6016, 6049–6067 | the `_viewRestore`, `_selectionBeforePress` and `_flash` fields in place of `_contentEditable`; the constructor's wiring |
| 6179–6537 | `commandApplies`, the twelve new private methods, `refocusSurface` |
| 6801–6867 | `setReadOnly`, `focus` |
| 7268–7270 | `toggleLink`'s read-only test |
| 7409–7487, 7504–7506, 7531–7544 | `copy`; the read-only tests of `cut` and `paste`, and their JSDoc |
| 8231–8329 | the `on` / `off` / `emit` overloads, `setContentEditable`, `getContentEditable` (`applyContentEditable` is gone) |
| 8336–8342, 8437–8438, 8461–8468 | `destructor`, the end of `buildEditor`'s list, `mountWysiwyg` |
| 9148–9163 | `updateSelectionState`: its early return while a view restore waits, and its comment |

The last row came with the third review's fixes and is the one edit behind `mountWysiwyg`. `feature/markdown-editor-raw-block-range-edits` changes nothing in that method. `$linkUrlToFollowAtCaret` calls `$readSelectionState`, which is in the untouched part (5184) and is not changed.

### Checks beyond the unit rows

- **The seeded fuzz**, on a private copy, with the harness files, seeds and sizes of the baselines `fuzz-b6`, `lif-b6` and `r7-b6`. The result and the commit it was run on are under *Verification*.
- **The read-only sweep** is the "every block kind" describe and the corpus runs of difference 3. For each of 19 documents, one per kind of block, the mounted editor is sent every DOM event of the route table at its first and last text node, every refused command, a text change under each text node and a node added to each block. After each step the saved Markdown, every node's key and type, the selection and the shown HTML are compared; at the end no `"change"` has fired, the editor is not dirty, and the undo depth equals an untouched twin's. Nothing throws.
- **Mutation checks**, one part broken at a time, the five test files run:

  | Broken | Rows that fail |
  |---|---|
  | Lexical left editable while read-only | G5, R1–R5, R6, R16, the sweep |
  | the guard not registered | G1, G2, G5, R13, the sweep |
  | the guard at the critical priority, not before it | G2, the sweep |
  | the guard does not report | G2, G5, R13 |
  | `COPY_COMMAND` refused too | G4, R9 |
  | a refused command left out of its list; a command with no handler put in it | G1 |
  | an edit intent reported but not cancelled | R2, R4, L2, L22 |
  | an edit intent cancelled but not reported | R2, R4, L2–L4, L9, L16–L18, L21, L22 |
  | edit intents handled while editable | R1 and R4 on an editable editor |
  | a paste, a cut or a drop that cannot be cancelled is reported | R24 |
  | an edit that cannot be cancelled is not reported; is reported but the view stays in; the editor does not take the view out when told | R3, R22; R22, R23, R25; R22, R23, R25 |
  | the view taken out for an edit that can be cancelled; on an editable editor; for a paste that cannot be cancelled | R2, R24, L2, L4, L9, L17, L18, L21, L22; R24; R24 |
  | taking the view out schedules no restore; a view still out is not put back by the task | R3, R23, the sweep |
  | the view put back by the task only, not with `input`; a view that is out counts as no view | R6, R8, R14, R17–R22, R25–R27, the sweep; R22, R25–R27 |
  | `input` asks for the view back only while read-only; the surface never forgets that its view was out | R26 |
  | `"selectionstate"` emitted while a restore waits; the state not compared when the restore is done | R27 |
  | the undo and redo keys left to the browser; every key with Ctrl stopped; keys stopped on an editable editor too | R1, R16; R1, R16, L22; L8, L22 |
  | Alt+Backspace not counted as an undo key, or Alt+Shift+Backspace as a redo key; either counted on an Apple keyboard | R1, R16; K2 |
  | `input` does not ask for the view back; the view is not put back | R6, R8, R14, R17–R22, R25–R27, the sweep |
  | the view put back on an editable editor too | R6 and R17 on an editable editor, R24 |
  | the view put back node by node, through `updateDOM` | R17, R22, R25–R27 |
  | the view put back by marking every text node dirty | R6, R14, R22, R25–R27 |
  | the selection not written back | R1–R8, R17–R19, R22, R23, R25, R27 |
  | Lexical not editable for the selection write; left editable after it; left not editable though read-only was lifted | R1, R18, R25; R1, R17, R18, R20, R22, R23, R26; R20, R26 |
  | the selection written back wherever the focus is | R21, R27 |
  | each change of a burst takes the selection anew | R19, R25 |
  | a waiting restore not called off on dispose; a selection whose nodes are gone written back | R20, R26 |
  | the restore waits for a task only; for a frame only | R29; R1, R8, R18, R19, R22, R25, R27, R29, the sweep |
  | the restore's task not called off; its frame not called off | R20, R26, R29; R26, R29 |
  | a refused command from code not reported | C1, C2, C5, M5 |
  | a refused edit does not flash; fires no event | G2, R2, M5, L2; and with them C1, C2, C5, G5, R13 |
  | the source editor's event not passed on; or it also plays the WYSIWYG wash | C4 |
  | `copy()` expands the caret while read-only; or copies the selection's own text | F4 |
  | a read-only editor focused through Lexical | F1, F4, F5, M6 |
  | an editable editor focused through its surface | F2 and the three existing focus tests |
  | read-only turns `contenteditable` off again | S1, S3, S4, S6, S8, S9, M1, L1, L10, L16, L17, L21 |
  | `aria-readonly` not written; no role; no `aria-multiline` | S1–S3, S6–S9, M1, M2; S1, S2, S6–S9; the same |
  | the text box state does not follow read-only; does not follow `contenteditable`; a text box whatever `contenteditable` is | S1, S3, S6, M1; S8, S9; S8, S9 |
  | the role, `aria-multiline` or `aria-readonly` kept with `contenteditable` off | S8, S9 |
  | `Aria.setReadOnly(null)` or `Aria.setMultiline(null)` removes nothing | S8, S9, the row in `Aria.test.ts` |
  | the surface not told of a change; constructed editable whatever the option | R1–R6, R8, R16–R23, R25, R27, the sweep; S1, S6, R14, the L rows |
  | the wash not mounted | M5 |
  | links: a click not passed on; passed on while editable | L5, L6, L9–L13, L15, L18–L20; L8, L11, L14, L15 |
  | links: a middle click not passed on; a click with any other button passed on | L6, L15, L19; L15 |
  | links: a held Enter not stopped; every Enter `keydown` stopped; every held key stopped | R1, L16; R1, L1–L3, L9, L10, L16–L18, L21, L22; R1 |
  | links: Enter not handed to the editor; the followed key not cancelled; the key cancelled but the link not followed | L1, L10, L16, L17, L21; L1, L16, L21; L1, L10, L16, L17, L21 |
  | links: Enter with a modifier follows; Shift+Enter follows; Meta+Enter follows; Enter while composing follows; Enter follows with no editing host; every plain key handed over as Enter | L22 |
  | links: Enter follows from a selection; follows any address | L3; L9, L18 |
  | links: a click that does not ask is followed | L6, L12, L19, L20 |
  | links: a later click of a run follows where it selected nothing (the third round's rule) | L6, L19 |
  | links: only the count of the click decides, so that a drag follows | L6, L12, L20 |
  | links: the second click of a run counts as a first | L5, L6, L10–L13, L19, L20 |
  | links: a click no pointer made judged like a first click; never follows | L6, L13; L6, L13, L15 |
  | links: text selected before the press counts as the click's; a changed caret counts as selected text | L6, L20; L5, L6, L10–L13, L19 |
  | links: the selection's mark holds the anchor only; leaves out the offsets | L6; L6, L12 |
  | links: the press not reported; only a press with the main button heard; the selection noted at a press kept for later clicks; the click given none | L6, L20; L6; L20; L6, L20 |
  | links: an empty address followed; an address of white space followed | L18 |
  | keys: the Apple keyboard's keys taken for the other keyboards'; an Apple keyboard given a Cmd+Y | K1, K2; K2 |
  | links: the click not cancelled; every click in a read-only editor cancelled | L5, L6, L9, L13, L15, L18; R1, L7, L15 |
  | links: a click reads Lexical's selection | L5, L6, L10–L13, L15, L19, L20 |
  | links: every address followed; the element's `href` followed | L9, L18; L9, L10, L15, L18 |
  | links: the scheme matched in the case written; a relative address with a colon followed; `tel:` and `sms:` not followed | L10; L9; L10 |
  | links: the same tab; the anchor left behind | L1, L5, L10–L13, L15, L16, L19; L1 |
  | the final round: the report emitted before the take-out; a cancelable edit cancelled after its report instead of before | R30; R30 |

  121 mutants; each fails at least one row. The last two, the final round's, were run on the final tip with R30 and the rest of the file; the other 119 on the tree before the rebase (*Verification*). One row was sharpened for it after the fourth review's fixes: L22 presses every other plain key at the caret, which a surface handing every key over as Enter passed before. Three were sharpened after the third review's fixes: R24 counts the reports, R26 goes on to an edit of the editor made editable, and R23 keeps the harness's own late first layout from putting the view back in the restore's place. Three more mutants change nothing a test can see, and were dropped: the undo keys also stopped at an editable surface (Lexical cancels the key there anyway), whitespace dropped from an address before the scheme is read (it only refuses more), and the scroll offsets not kept across the remount (jsdom keeps them; a browser check).

### Browser checks

Run in headless Chromium 155 against the worktree's own demo server (`127.0.0.1:5397`, not 8015), "MD Editor" page, with the new Read-only toggle. Input was real: key, mouse, drag and input method events sent through the browser's debugging protocol, not dispatched from script. The scripts are in the run's scratch folder (`browser/`). The whole list was run again after each review's fixes, the last time on the code as it stood after the fourth round, before the stack was rebased (`component/editor/` is byte-identical across the rebase). The fifth reviewer's probes ran on the code after the rebase (*Changes made after the review*). Nothing of the list was run again for the final round. The second, third and fourth reviewer's own scripts for their findings were run with it.

| Gesture | Result |
|---|---|
| X1 Tab from the toolbar | the surface has focus, `:focus-visible` holds and the browser draws its focus ring; the caret is at the document's start |
| X2 arrows, Home, End, Ctrl with them, PageUp, PageDown | the caret moves, Lexical's selection with it; no event, no flash. At the first and the last line the caret stays and focus does not leave |
| X3 Shift with the keys, Ctrl+A | text is selected; Ctrl+A stays inside the editor |
| X4 a double click, a triple click; a drag across table cells | a word and a block are selected; six cells are selected and highlighted, and Ctrl+C copies them, as at the base |
| X5 Ctrl+C | the selection is on the clipboard (read back by pasting into a text field) |
| X6 Shift+F10, the ContextMenu key | the menu opens with Copy alone, at a caret and at a selection; Escape closes it; Copy, clicked, copies and returns focus to the surface. Arrow keys still go to the editor while it is open (the plan's non-goal) |
| X7 a letter, Enter, Space, Backspace, Delete, Ctrl+Backspace, Ctrl+B, Ctrl+I | nothing changes; one event and one flash each. Backspace at the document's start and Delete at its end are reported too |
| X8 Tab, Shift+Tab | focus moves to the next and the previous control, from prose and from a table cell; no flash. Shift+Tab back into the editor finds the caret where it was |
| X9 Ctrl+V; Ctrl+X on a selection | nothing changes; one flash each; the clipboard holds what it held |
| X10 a drop of text from outside; selected text dragged and dropped inside | nothing changes; one flash each |
| X11 edits made, read-only on, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z | nothing changes, no event, no flash. With text typed into another field of the page last, the keys leave that field and the focus alone (difference 9) |
| X12 a composition (two composition updates, then a commit; in one run a single dead-key step): at a caret in a paragraph's text, at a block's end, in a heading, in a link, in a list item (twice), in a table cell, a code block, a raw block, the last paragraph and an empty paragraph; over a selection in plain text; and over the selections of the second review, made with real keys and the mouse (8), set by script from the start of a code, bold, italic, struck, coloured or linked run into the text after it, across blocks, cells and a hard break (19), and over whole inline nodes, an image and everything (16); 8 more with the browser's own selection gestures | the document, the shown HTML and the dirty flag are unchanged in all 63. One event for each step of a composition. The caret, or the selected text, is where it was afterwards, and in an 80-paragraph document scrolled to its 60th the scroll offset is too; an arrow key and a letter then act there |
| X13 a selection made while read-only, then read-only off and a letter | the selection survives both switches and the letter replaces it; Ctrl+Z takes it back |
| X14 cells selected with the mouse, then Ctrl+V, a letter, Backspace, Delete | nothing changes; one flash each |
| X15 the caret moved through a table cell and a link | `inTable` and `linkUrl` follow it |
| X16 arrows through table cells, past an image, into a code block and a raw block | the caret moves through all of them. **Shift with an arrow carried past a cell's edge:** the table plugin takes the cells as its own selection, and the browser's selection jumps to the document's start; Ctrl+C then copies the cells. Recorded as a limit in the docs, as the plan allows |
| X17, with functionality 2: Enter in a link reached with the arrow keys; a click, a Ctrl+click and a middle click on a link | a new tab opens at the link's address; the page stays; no flash. Shift+Enter, Space, a letter, Enter over selected link text and Enter outside a link are refused edits; Enter held down for three repeats opens one tab; at 18 caret places around a link Enter opens it exactly where `linkUrl` reports it. A relative address opens against the page's own; a `javascript:` one opens nothing. With `setContentEditable(false)`, a click, a middle click and Enter on the focused link each open one new tab, at the address as written, and the page stays. An editable editor follows none |
| a drag over a link's text, pressed at a glyph's edge: inside the link, into it, out of it | the text is selected and nothing opens, read-only and editable. A double click on a link's word opens the link on its first click and selects the word |
| X20, after the third review: one, two and three clicks on a link; a click on it with everything selected, with a word of the link selected (on that word, and beside it), with text elsewhere selected; a drag over its text; a middle click; a click beside it; each with the surface an editing host and not. As an editing host, also Enter with the caret in the link and with text of it selected; not as one, Enter on the focused link with everything selected and with the link's own text selected | the link opens once in each case but three, which open nothing: the drag, the click beside the link, and Enter over selected text. 24 gestures. Seen on the way: at a click inside a standing selection the browser's selection is still that selection, and collapses after the click |
| X21, after the third review: a composition of three updates and a commit, at a caret in a paragraph, over a selection, in bold text, in a table cell and far down a long document, with another script's `input` listener in the capture phase on the window (a `beforeinput` one beside it), on the document, on the window in an isolated world (where an extension's content script runs), and with none | the document, the shown text, the dirty flag, the caret or the selection and the scroll offset are unchanged in all 20; no `"change"`, no `"selectionstate"`. The view is out at each `beforeinput` and back at the `input` after it; no frame is painted in between |
| X23, after the fourth review: runs of one to six clicks on a link, `http` and `mailto`, the surface an editing host and not | the link opens once in each of the 12 runs. A new single click on the block the run left selected opens it once more, as a single click on text selected already does |
| X24, after the fourth review: the caret walked with the arrow keys through a row of image links, an image link in prose, an image link alone and a link of text around an image, Enter at each place | Enter opens the link at every place where `linkUrl` reports one (3 of 3 in the row of badges, the second badge among them; 9 of 9 in the other document) and is a refused edit at every other. Shift+Enter is a refused edit; Ctrl+Enter and Alt+Enter do nothing; Enter held for three repeats opens the link once |
| X25: a refused composition on a surface that is scrolled, far down 80 paragraphs, and at the end of a document of twelve tall images; the offset read at every frame and every scroll event, with and without another script's `input` listener on the window | text: one offset at every frame, in 13 runs of 13. Before the restore was also requested for the next frame, the document's start was painted for one frame in one run of nine, and in every run of a probe that asked for a frame itself. Images: no other offset in 9 runs of 10; in one, with the images served uncacheable, one frame near the top (a limit of rendering the view anew, difference 3) |
| X26: another script's capture listeners on the window, registered ahead of the framework's: one that stops `beforeinput` and one for `input`; the first alone; both only listening. A letter, a composition, Backspace | both: Backspace and the composition change the document, `"change"` fires (the second route that stays open). The first alone, and both only listening: nothing changes |
| X27: the accessibility tree of the surface in its four states, of the source surface, and of each option for the read-only gap | under *Accessibility* and decision 13 |
| X22: a refused composition with table cells selected by a drag | the cells stay selected and the document unchanged; the browser's caret, which was in the last cell, is at the document's start afterwards, and the next arrow key moves it from there (the limit of row R28) |
| X18 source mode, read-only: a letter | the source editor flashes, the WYSIWYG wash does not, the editor's `"readonlyedit"` fires once; Tab moves focus on |
| a script's `execCommand` (`insertText`, `delete`, `bold`, `undo`, `insertHTML`) | nothing changes; no event |
| a script's `execCommand('insertText')`, a script's write into a text node followed by an `input` event it dispatches, and the bare write, each with and without another script's `input` listener ahead on the window | the first two are put back in both cases: Chromium sends `input` and no `beforeinput` for them, and gives no turn to an observer between the listeners of an event sent from running script. The bare write reaches the document (row R15) |
| commands from code (`toggleBold`, `insertTable`, `cut`, `paste`, `setBlockType`), and a letter after `setContentEditable(true)` | nothing changes; one event and one flash each |
| Ctrl+Alt with an arrow | spatial navigation moves focus to the neighbouring component |
| a read-only editor as the content of a modal `Dialog` | it takes the initial focus; Tab and Shift+Tab cycle inside the dialog; the first Escape releases the editor and the dialog stays open |

- **The composition** was a real one as far as the browser is concerned (`Input.imeSetComposition`, `Input.insertText`), not script-dispatched events. No input method is installed, so one driven by an operating system's IME is a manual check.
- **Modifier and platform combinations with Enter.** Run in a browser, in Chromium on Linux: Enter alone, Shift+Enter, Ctrl+Enter, Alt+Enter, and Enter held. **Not run:** Cmd+Enter or Meta+Enter anywhere, and every combination on macOS and on Windows. For all of them the editor does not take the key and leaves it to the browser (row L22 presses every combination under jsdom, including a browser that announces an edit for it).
- **Not run:** X19 (macOS), where the undo and redo keys are Cmd+Z and Cmd+Shift+Z (rows K0 to K2 run that half of the test under jsdom; pressed on a Mac it is a manual check), a screen reader, Firefox, WebKit, a headed browser. A Shift+click on a link: this Chromium extends no selection for one sent through the debugging protocol, so only row L6 holds its shape. A middle click on a link under Linux, where a browser may also paste the primary selection: headless Chromium fires no such paste; if it does, the paste is a refused edit, and the editor would flash while the link opens.
- **Manual checks the fourth review adds, with what to look for:**
  - *Windows, where the user works:* Alt+Backspace and Alt+Shift+Backspace in a read-only editor, after typing into another field of the page. Nothing in that field is taken back or put back, the focus stays in the editor, and nothing flashes. On this Linux machine the keys do nothing in Chromium with or without the code, so only the rows hold them (R1, R16).
  - *Android, with an on-screen keyboard:* tap into a word of a read-only editor. The caret is placed and nothing flashes; then type a letter: one flash, nothing changes. A keyboard there starts a composition around the tapped word with no text to write, which is why the report moved off `compositionstart` (difference 13). Whether such a tap sends a `beforeinput` at all could not be seen here; if it does, it flashes, and the report would have to compare the text. Under the debugging protocol a press in the middle of a glyph, followed by moves, selects nothing anywhere in the editor, plain text included, at the base as well; pressed at a glyph's edge the same moves select. So what a hand's drag over a link does was seen only for edge presses, and is a manual check.

### Found on the way

- **An editor constructed with `> a\n<div` reports `> a\n\n<div` and is dirty as soon as it is built.** At the base too. `buildEditor` loads the document and then registers the node rules, and registering a rule marks every node of its type changed, outside the load. `setValue()` loads the same text unchanged. One of the corpus's 492 documents; the rules that rewrite it are the ones difference 3 keeps away from.
- **Lexical puts a rewritten address on a link's element**: `other.md` is `https://other.md` in the `href`, on every editor. Nothing follows that `href` while the surface is an editing host. On an editable editor with `setContentEditable(false)`, a browser does follow it, in the same tab, as before this branch; a read-only editor now cancels that (difference 8).
- **The surface carries no `translate="no"`,** which CodeMirror writes on the source surface. A page translation would write into the surface's text, on an editable editor as well, by the route R15 pins.
- **A link in a read-only editor keeps the text caret as its mouse pointer,** as everything in an editing host does. A pointer over a link that a click follows would say so; it needs a state rule for the read-only surface.
- **At a link's last character the browser's caret is in the link's text and the editor's is behind the link,** so `linkUrl` is `null` there and Enter is a refused edit; at its first character both are in it. Lexical's own normalisation, on every editor.
- **On an editable editor, typing or composing at the start of a paragraph that begins with a link is swallowed.** Not this branch: the same at the base (the fourth review's probe, `browser/r4/p4-editable.mjs`, case "click in link, then Enter": the composed text and the letter after it never reach the document). The cause is in Lexical: where the caret is at offset 0 and the text's parent says no text may be inserted before it, which a link says, `$updateTextNodeFromDOMContent` marks the node changed and takes nothing. It wants a plan of its own.
- **`$linkHolding` in `markdownReadOnly.ts` is the same search as `$findEnclosingLinkNode` in `MarkdownEditor.ts`.** The module cannot import from that file, which imports it, and the helper has no shared home; moving it into one touches a region of `MarkdownEditor.ts` this branch keeps away from. Left for the link plan (see *For the plans that follow*).
- **Selecting cells with the mouse** leaves the browser's and Lexical's selections apart in a read-only editor, as at the base: the table plugin acts on the selection whether the editor is editable or not. The keyboard now reaches the same state (X16).

### Changes made after the review

The first review round had three blocking findings. Each was fixed, with its advisory findings, and folded into the commit it belongs to.

| # | Finding | What was done |
|---|---|---|
| B1 | With `setContentEditable(false)` on a read-only editor a clicked link opened twice, the browser following it too and the page leaving | One rule for a click on a link (difference 8): its default is always cancelled. Rows L5–L7 rebuilt from the table of shapes, L13 and L14 new |
| B2 | A relative address was followed to another host (`other.md` to `https://other.md`), the address being the element's `href` | The address is the one written, tested against an allow-list of the editor's own (difference 8). Rows L9 and L10 enumerate the forms |
| B3 | The notes gave a fuzz result that was not obtained on the final code, and pointed to a record that was not there | The run was made again on the code after these fixes; *Verification* names the commit |
| A | G1's third assertion could not fail for a refused command | it counts listeners |
| A | The Known limits list had ended up under *Following a link* in the docs | the subsection is the last of the Read-only section |
| A | `focus()`'s JSDoc said the editor is built; the notes counted the compositions three ways and left the link listener out of difference 6; the accessibility page said `aria-readonly` is present only while read-only | each corrected |
| A | The two command lists were cast | typed `AnyLexicalCommand` (difference 4) |
| A | The text box has no accessible name; R15 needs the user's word | listed under the decisions below; nothing changed |

Found while checking the fixes in the browser, and fixed with them: the undo key pressed in a read-only editor undid another field's edit (difference 9).

The second round had four blocking findings, two in the code.

| # | Finding | What was done |
|---|---|---|
| B1 | A composition over a selection that starts where a formatted run begins changed a read-only document: the repair of single text nodes did not cover what the browser does there | The view is rendered anew, and the selection written back a task later (difference 3). One rule for the area; rows R17 are built from twelve shapes of damage, R18 to R21 from the second half's cases. The reviewer's 8 gestures and its other 35 selections pass in Chromium |
| B2 | With `setContentEditable(false)` a middle click still followed the address on the link's element, to another host | The surface passes a middle click on too, and the click is the editor's alone whatever the button (difference 8). Row L15 |
| B3 | The link commit's message says the address goes through the link's own sanitizer, which is no longer so | reworded when the fixes were folded in |
| B4 | The notes said a drag on a link ends as a click in headless Chromium and a headed browser drags the link, which was not observed | The claim is gone. What was seen, by the reviewer and then here, is in the browser table and under "Not run" |
| A | The fixups do not fold mechanically | the commits were rebuilt by hand, each fix in the commit it belongs to, and the final tree compared |
| A | A held Enter opened the link once for each repeat | the repeats are stopped (row L16) |
| A | The comment on the address schemes said they are the ones a link may carry | it says whose list it is |
| A | Layer 4 depends on listener order more than its comment said | the comment said which listener must come first, and difference 3 said it. The third review showed that the order cannot be had, and the dependence is gone for every edit the browser announces |
| A | The docs said nothing changes the selection, under bullets saying the keys move it | reworded |

Found while fixing: Enter followed a link from the browser's caret, which at a link's edge is not where the selection state reports a link; it now reads the editor's own caret (row L17).

The third round, the last the loop allows, had two blocking findings, both in the code. They were fixed once, with the advisory findings. The fourth review read these fixes.

| # | Finding | What was done |
|---|---|---|
| B1 | A triple click on a link opened it twice: the rule looked for an end of the selection in the link, and the block a third click selects encloses the link | One rule for the area (difference 8): a click is followed unless it selected text itself, which is judged from what was selected before the press. Row L6 runs it over every pair of selections, click count and button; L19 and L20 are the reported shape and its neighbour. In Chromium a single, a double and a triple click each open the link once, with the surface an editing host and not |
| B2 | A composition changed a read-only document where another script's listener for `input` was on the window ahead of the framework's, an extension's included: Lexical's observer had its turn before the view was rendered anew | The view is out of the surface before the browser makes a change it announced and could not be talked out of (difference 3). Rows R22 to R26. In Chromium the reviewer's two cases and 18 more leave the document as it was |
| A | A `"selectionstate"` away and back with every refused keystroke | none is emitted while a restore waits (row R27) |
| A | With table cells selected the browser's caret is not put back | not fixed: Lexical writes no browser selection for a selection of cells, and writing one by hand beside the table plugin's is a change of its own. Row R28 pins what holds; the docs' Known limits and decision 11 name it |
| A | A link with an empty address was followed, to the page the editor is on | an address of nothing, or of white space, is not followed (row L18) |
| A | `$linkHolding` duplicates `$findEnclosingLinkNode`, and narrows what is already narrow | the narrowing is gone and the comment says why the search is written twice (see *Found on the way*) |
| A | The comment and difference 5 said no installed Lexical package uses the guard's priority | both say which one does, and that the editor does not register it |
| A | The update that writes the selection back stood with no blank line around it | given them |
| A | The Apple half of `isUndoOrRedoKey` had no row | rows K0 to K2, in a test file that gives the platform before Lexical is loaded. On a Mac itself it is still a manual check |
| A | A middle click on Linux may also paste the primary selection | not verified, headless Chromium firing no such paste; under "Not run" |
| A | The docs did not say that a double click on a link's word opens it on the first click | they do, with the rest of the click rule |

The places in these notes that finding B2 names (that the document never takes a composition, that R15 is the one exception, that the surface's handler runs first) are rewritten above with what is so now.

A fourth review was run from outside the loop. It read the third round's fixes: the caret, selection and refusal code, and the take-out for compositions, held under everything it ran. It had three blocking findings, two in link following and one in these notes. The fifth review read the fixes below.

| # | Finding | What was done |
|---|---|---|
| B1 | A run of four or more clicks on a link opened it again on every click from the fourth: the selection is the same before the press and after it from there on, which the third round's rule read as text selected already | One rule that cannot leak (difference 8): a run of clicks follows its link at most once, on its first click; a later click never follows, whatever is selected. Rows L6 (`detail` 0 to 8, both buttons, with and without a selection before, `http` and `mailto`: 11,016 clicks) and L19 (runs of one to eight). In Chromium, real runs of one to six clicks open the link once |
| B2 | Enter did not follow a link with the caret beside an image inside it, where `linkUrl` reports the link: Chromium announces a line break there, and Enter was told by its paragraph break | Enter is decided at `keydown`, by the key, and asks the function that computes `linkUrl` (difference 8). A paragraph break or a line break that reaches `beforeinput` is a refused edit, which also closes the review's fourth advisory. Rows L21 (every caret place of eight documents, for either kind of edit the browser would announce), L22, L4, L16. In Chromium, Enter follows at every place the review listed |
| B3 | The read-only state does not reach Chromium's accessibility tree, and these notes said a screen reader user is told "read-only" | The claim is withdrawn in the notes, the plan's own section and the docs, with what was measured (*Accessibility*). The gap itself is not closed in code: the options, each with the measured tree, are decision 13 |
| A1 | A route the notes did not name: a listener ahead of the framework's that stops `beforeinput` and also hears `input` | Not closable at `input`: the document is changed, and `"change"` sent, before the surface hears of it. Named, with its exact condition, in the routes section, decision 4 and the docs; row R15 pins it |
| A2 | Alt+Backspace and Alt+Shift+Backspace are the browser's undo and redo on Windows | stopped with the other undo and redo keys, on every keyboard but an Apple one (difference 9); a manual check on Windows |
| A3 | With `setContentEditable(false)` the surface kept `role="textbox"` and `aria-readonly` while it is neither focusable nor editable | the three attributes are written only while the surface is an editing host (difference 14); the tree is measured for the four states |
| A4 | Any `insertParagraph` at a caret in a link opened it | closed by B2 |
| A5 | The temporary `setEditable(true)` has no precedent; `$updateDOMSelection` might do without | tried, and it works; not kept, since it has to write through the seam's read side (difference 3, decision 2) |
| A6 | The browser row "far down a long document" never scrolled the surface | it does now, and the check found a frame painted at the offset the browser scrolls to in between; the restore is also requested for the next frame (difference 3, row R29, X25) |
| A7 | A `compositionstart` with no text change, as on Android after a tap, would flash | the report moved to the `beforeinput` that announces a composition's text (difference 13); a manual check on Android |
| A8 | On an editable editor, input at the start of a paragraph that begins with a link is swallowed, as at the base | recorded under *Found on the way*, with the probe, for a plan of its own |

A fifth review read the fourth round's fixes (`git diff 1dfaca4ce 87288f0a2`), judged at the rebased tip `356fde5ea`. It found no code defect, and probed Chromium again (Enter at 38 caret places, 60 click gestures, 4 compositions, the accessibility tree), with a spot check of 20 mutants, all killed. Its one blocking finding was in these notes, which stated facts that were false at the tip, and it left seven advisory ones.

The final round, the one after the fifth review, fixed them. **These fixes have been read by no reviewer: the owner decided on 2026-10-12 that this round is the last and that the plan closes after it, without another review.**

| # | Finding | What was done |
|---|---|---|
| B1 | Six statements in these notes were false at the tip: two slips of the fourth round (the S describe's line range, "eleven" new private methods for twelve) and four stale since the rebase (the base `a11d86be6`, the verified tree `c3a7557c7` "the same at the tip", the suite counts, the "560 files, 18,388 tests") | Corrected, and the whole section swept for figures of the same kind: the line-number tables, the counts, hashes and base names. *Verification* now says what was run on the tree before the rebase, that `component/editor/` was byte-identical across it, and what was run again on the final tip |
| A1 | A host `"readonlyedit"` listener that throws could defeat the take-out: the report was emitted before it, and `ListenerBag.fire` does not isolate exceptions. In Chromium, with such a listener and another script's capture `input` listener ahead on the window, a composition changed the document | `handleBeforeInput` emits `"unpreventableedit"` before `"readonlyedit"`; `handleEditIntent` cancels the edit before it reports. Row R30 fails on the previous tip and passes; the two mutants that undo either change fail R30. It is an offline row: the browser reproduction (`review5/pD-order.mjs` in the scratch folder) was not run against the fix, so that is a manual check |
| A2 | The JSDoc of `handleReadOnlyEnter` said the editor's caret "by the time a key is pressed has followed the browser's"; back to back keys (an arrow, then Enter) are decided on the caret from before the arrow | The comment says so, and that it is consistent with `getSelectionState().linkUrl` at that instant |
| A3 | The docs and difference 8 said that with Ctrl, Alt or Cmd held "the key does nothing"; the code only leaves the key to the browser | The docs page and the table in difference 8 say what the code does, and *Browser checks* says which modifier and platform combinations were run in a browser and which were not |
| A4 | The sentence "*Corrected after the fourth review.*" under *The surface is exposed as a multi-line text box* is an edit to the plan body, outside this section | Left as it is, by decision. It is marked, and difference 14 records the same change. This is the one edit outside *Implementation Notes* |
| A5 | The notes commit's message said the last two rounds' fixes were read by no reviewer, against what these notes said | The message and the places in these notes that said the fixes are unread now say that the fifth review read the fourth round's, and that the final round's are unreviewed by the owner's decision |
| A6 | Three comments said a view restore is finished "a task" later where it is a task or a frame | `updateSelectionState`, `restoreView` and `takeOutView` say "a task or a frame" |
| A7 | The JSDoc of `setContentEditable` omitted that turning it off removes the text-box role and both ARIA properties | It says so |

### Verification

What was verified where. The branch was checked on the tree it had before the stack was rebased, and again on the final tip; the two are not the same tree.

- **Before the rebase** (tip `87288f0a2`, `packages/lib/src` tree `c3a7557c7`, parent `a11d86be6`): `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm run lint`, `npm run docs:api` (no warnings), `npm run docs:llms:check` and `npm run build:lib` were clean or succeeded. The full suite was 560 files, 18,388 tests passed and 2 todo. The seeded fuzz was run on the sources of the work-in-progress commit `0a5cb7e06`, which has that `packages/lib/src` tree: seeds 601 to 11003 at 3,000 steps for the paste and table-edge families, strict and not, at 1,500 for list-edit, and the five reviewer-7 seeds. All 60 runs ended with exit 0, and all 60 result files are byte-identical to the baselines `fuzz-b6`, `lif-b6` and `r7-b6` of the raw block edge cases run (`fuzz/cmp.sh f5`: identical 60, differing 0, missing 0). The mutation checks (the table above) ran in three private copies of a commit with that tree: 119 mutants, one of which survived the first run (every plain key handed over as Enter) until L22 was extended; each of the 119 fails at least one row. The browser list ran on that code. None of this was run again after the rebase, except as the next two bullets say.
- **Across the rebase** (2026-10-12): the stack was rebased into one line, and the branch moved from `a11d86be6` to `d9874ae99`. `packages/lib/src/typescript/lib/component/editor/` is byte-identical before and after (tree `d0cea98c2`), on this branch's tips `87288f0a2` and `356fde5ea` and at both parents; so are `docs/components/MarkdownEditor.md` and the two test files that hold the rows (`markdown-editor.test.ts`, `markdown-editor-readonly-mounted.test.ts`). The rest of `packages/lib/src` is not: its tree went from `c3a7557c7` to `46447beb2`, with 63 source files and 53 test files differing from the tree of the checks above. So the results of the first bullet are those of the editor code and its tests, and not of the tip's whole tree. The fifth review ran at `356fde5ea`: `tsc` on both configurations (0 errors), `eslint src` (clean), the full suite with `--maxWorkers=2` (583 files, 19,141 passed, 2 todo), `typedoc` (0 warnings) and `docs:llms:check` (OK).
- **On the final tip** (`packages/lib/src` tree `c0ef1da41`, parent `d9874ae99`): `npm run typecheck`, `npm run typecheck:test`, `npm run lint` and `npm run docs:llms:check` (coverage OK) are clean, and the full suite (`vitest run --maxWorkers=4` in `packages/lib`) is 583 files, 19,142 tests passed and 2 todo: the 19,141 of the fifth review and the new row R30. R30 was written first and failed on the previous tip, and the two mutants of the final round fail it. **Not run again on the final tip:** `npm run docs:api`, `npm run build:lib`, the fuzz, the 119 earlier mutants, and the browser list. The final round changed `handleBeforeInput` and `handleEditIntent` in the order of two calls and in a `preventDefault`, and comments, a JSDoc and a docs sentence, so that the fuzz, which drives edits and not read-only editors, and the browser list were judged to be unaffected; that is a judgement and not a measurement.
- **A manual check for the final round's code change:** in a browser, with a read-only editor, a host `"readonlyedit"` listener that throws, and another script's capture `input` listener on the window registered ahead of the framework's, compose text in the editor. The document, the shown HTML and the dirty flag must be unchanged. The fifth review's probe `pD-order.mjs` does this; it was not run against the fix.
- The plan's greps: `_flashOverlay`, `_flashAnimation` and `READONLY_FLASH_MS` are nowhere in `CodeEditor.ts`; `markdownReadOnly.ts` and `ReadOnlyFlash.ts` are not in `component/editor/index.ts`.
- The rebase-clean checkpoint: the branch stands on `feature/spatial-navigation-redesign` (`d9874ae99`), its start point and a phase start and not `master`, so there was nothing to rebase. Before 2026-10-12 it stood on `a11d86be6`.
- **Review status.** The fourth round's fixes were read by the fifth review, which found no code defect. The final round's fixes are unreviewed, by the owner's decision of 2026-10-12.

### Decisions that await the user's sign-off

**Decided on 2026-10-12, and no longer open:** decision 1 (links), decision 13 (the accessibility gap) and decision 6 (a `Dialog`'s initial focus), as they are marked below; and decision 12 (the fourth round's fixes are read, by the fifth review). The rest still await the owner.

1. **A read-only editor follows its links** (difference 8). *Decided 2026-10-12: it follows them as built, by a plain click, a middle click and Enter, in a new tab.* Enter in a link and a click on one, in a new tab. It reverses a non-goal of the plan, for a read-only editor only. Choices inside it that are the user's: that a plain click follows, and a middle click (the alternative is Ctrl/Cmd+click, which would leave a click free to place the caret in a link's text); that a run of clicks opens the link once, on its first click, so that a double click on a link's word opens the link on the way to selecting the word (the alternative, waiting out the double-click interval, opens every link late); that a click on a link's text that is selected already opens it; that Enter follows only when pressed alone, and at every caret place where `linkUrl` reports a link; that every link opens in a new tab with no hook for the host (the viewer has `linkResolver`); and the allow-list of addresses, which refuses a relative address that holds a `:`, an empty address, and every scheme but `http:`, `https:`, `mailto:`, `tel:` and `sms:`, `ftp:` among them. Separate commits: "Follow a link in a read-only MarkdownEditor" and its documentation commit. Without them a read-only editor's links do nothing.
2. **The restore** (difference 3): for an edit that cannot be cancelled the view is taken out of the surface before the browser makes it and rendered anew after, and the selection is written back in the next frame or a task, whichever comes first, with Lexical editable for that one update, where the plan marks every text node changed. Three things in it are the user's. A refused composition costs a render of the whole view per keystroke, and the host hears no `"selectionstate"` for the moment the restore takes. With images in the document, a frame at another scroll offset can be painted while the images of the view rendered anew are laid out (one run of ten here). And the selection is written by making Lexical editable for one update: `$updateDOMSelection`, which Lexical exports, does it without that and was tried, but it needs the browser's live selection handed to it for writing, and the DOM seam has only a read-side escape for that; a write-side one (`DOM.sink`) would be a new member of the seam, which is the user's to add or not. Part of the first code commit; it cannot be separated without bringing back a repair that changes documents.
3. **Keys and presses taken at the surface** (difference 9), where the plan listens to no key: the undo and redo keys, Alt+Backspace with or without Shift among them on every keyboard but an Apple one, are stopped quietly. Part of the first code commit. With functionality 2 the Enter key is taken where it follows a link, a held Enter's repeats are stopped anywhere in a read-only editor, and the surface hears every press of the pointer while read-only, to note what is selected.
4. **The two routes that stay open** (row R15). The first: text a script writes into the surface with no event at all, as at the base and as on an editable editor. The second, named by the fourth review: a key's or a composition's edit where another script has, on the window and registered before the framework's, a capture listener that stops `beforeinput` and a listener for `input`; Backspace and a composition then change the document. Either alone is harmless. Closing both needs a mutation observer ahead of Lexical's, which means a new member of the DOM seam and a way to tell Lexical's own rendering from a stranger's write; taking the change back out of the editor's state afterwards would close the second at the price of a second `"change"` and a step in the undo history. `translate="no"` would close the commonest source of the first, a page translation. Nothing was changed; both are in the docs' Known limits.
5. **What is reported.** Every refused edit the surface sees flashes, including each keystroke of a composition (where the browser announces its text, difference 13, not at its start as the plan has it) and Backspace where there is nothing to delete; the undo and redo keys, a held Enter's repeats, Ctrl+Enter and Tab do not. The docs say so.
6. **A `Dialog` gives a read-only editor its initial focus** *(decided 2026-10-12: a `Dialog` whose first content is a read-only editor gives the editor the initial focus, as built)* when the editor is its first content, where the base gave it to the primary button (and 0.10.0 gave it to the editor). A host that wants a button focused passes `initialFocus`. No code was changed for it and no migration note written, 0.10.0 behaving as the branch does.
7. **`getContentEditable()` is `true` on a read-only editor** and `setContentEditable` acts at once. The user's decision that `setContentEditable(true)` cannot make a read-only surface editable is kept by the layers and pinned (S5, G5), not by holding the attribute back as the base did. This is the plan's own decision; it is listed because the base's behaviour was accepted on 2026-10-10.
8. **The text box has no accessible name** and a host cannot give it one. A follow-up; it wants an option on the editor.
9. **The table limit** (X16), the **spelling marks** and the **on-screen keyboard** of a read-only surface, all inside the plan's non-goals.
10. **Docs beyond the plan** (difference 11) and **rows beyond the plan** (difference 10).
11. **With whole table cells selected, a refused composition does not put the browser's caret back** (row R28): the cells stay selected and the document unchanged, and the next arrow key starts from the document's start. Left as a known limit, in the docs.
12. **The fourth round's fixes are unread.** *Settled 2026-10-12: the fifth review read them and found no code defect. The final round's fixes are unreviewed by the owner's decision, and the plan is closed.*
13. **The read-only state does not reach a screen reader in Chromium** (*Accessibility*). *Decided 2026-10-12: the gap is left as documented for now (option D), with an accessible description (option A) to follow once the library has a table of built-in strings.* The code is as it was: `aria-readonly` on the editing host, which is right for a browser that honours it. What Chromium's accessibility tree shows for each way of closing the gap, measured on the read-only surface:

    | Option | The tree | What it needs | Cost |
    |---|---|---|---|
    | D. Leave it, matching CodeMirror | `textbox`, `multiline: true`, `readonly: false`, `editable: "richtext"`, `settable: true`; the source surface's `.cm-content` reads the same with `editable: "plaintext"` | nothing | a screen reader user in Chromium meets a field announced as editable that takes no typing, on both surfaces |
    | A. An accessible description on the surface while read-only (`aria-description`, which `Aria.setDescription` writes, or `aria-describedby`) | the same, with `description: "Read-only"` | one built-in string | the string. The library has no table of built-in strings and no localisation; the plan `dialog-close-button-label.md` on master proposes a `strings` option on `Body` for them and is not implemented. A description is read when the field takes focus, so it speaks before the user types |
    | B. A polite live-region announcement when an edit is refused | a `status` node with `live: "polite"`, `atomic: true`; the surface's own node unchanged | one built-in string, and an announcer | the library has no announcer beyond `Notification` and `StatusBar`, so the editor would need a live region of its own, a new element and a new pattern. Whether a reader speaks it, and how often for a held key, cannot be measured in the tree. It is what answers "the field ignores my typing" |
    | C. `aria-roledescription` on the surface | the same, with `roledescription: "read-only text"` | one built-in string | it replaces what a reader says for the role, and ARIA advises against it where the role already says what the thing is |
    | (not an option) no editing host, a `tabindex` instead | `readonly: true`, no `editable` | | no caret and no keyboard selection: the surface this plan replaced |
    | (not an option) `aria-disabled` | `disabled: true` | | the wrong meaning: a disabled field is not for reading |

    **Recommended:** D for this branch, with the claim corrected, which is what is there; then, once `Body`'s `strings` table exists, A with an entry of its own, since it needs no new element and speaks before the first keystroke, and B after it if a host should not have to wire `"readonlyedit"` to an announcement itself. No option was implemented: each one that changes the tree needs a user-facing string. Until then a host cannot close the gap either, the surface being private (decision 8).
14. **The surface is no text box after `setContentEditable(false)`** (difference 14): it carries no role and neither property, read-only or not, where the plan writes them always. `Aria.setReadOnly(null)` and `Aria.setMultiline(null)` were added for it, following `Aria.setHidden(null)`.

### For the plans that follow

**`markdown-editor-raw-block-range-edits`** (to be rebased onto this stack)

- The touched regions are listed above. `copy()` is the one method both change: this branch added a `readOnly` constant, a guard around the `$selectEnclosingWordIfCollapsed` update, the `expansion` branch at the top of the read, and `this.refocusSurface()` in place of `this.ensureEditor().focus()`. In `copyWysiwygSelection` they go where the plan's snippet shows.
- A rule registered for a changed node does not run when a read-only editor's view is put back, so nothing it does there needs a guard. An update listener does run, twice, for the remount: once with no root and once with the previous state empty, as at the first mount. Between a `beforeinput` that cannot be cancelled and the `input` after it, a read-only editor has no root element (`getRootElement()` is `null`); code that runs from another listener of those two events must not take that for an editor that was never mounted.
- `updateSelectionState()` returns early while a view restore waits. A call added for a new state field needs nothing for it: `finishViewRestore` calls it once the restore is done.

**`markdown-editor-table-command-fixes`**

- Its part C rewrites `refocusSurface()`. The method now takes `preventScroll` and has a read-only branch that focuses the surface and does not call Lexical's `focus()`: Lexical writes no selection while it is not editable, and rows F1, F4, F5 and M6 pin that it is not called. Keep that branch in front of the new body. `focus()` already goes through `refocusSurface()`, and `copy()` already ends with it.
- `commandApplies()` starts with `refuseIfReadOnly()`; its new last lines go after that.
- Its mounted harness sets `root.tabIndex = 0` "since jsdom focuses no bare `contenteditable`". jsdom 29 does focus one (rows M1 and M6), and it also collapses the selection to the focused element on every `focus()`.
- The warning it removes ("ran while a read-only context was on the stack") is Lexical's own term for a read, and has nothing to do with a read-only editor.

**`markdown-editor-link-format-command-fixes`**

- It adds `FORMAT_TEXT_COMMAND` dispatches to the read-only loop of the consistency test. The guard refuses that command ahead of `$handleFormatCommand`, changes nothing and reports once, which is what the loop now asserts (`"readonlyedit"` once per command). Its mutation row "drop `editor.isEditable() &&`: the command routes of the read-only loop fail" will not fail any more: the guard stands in front of that test.
- The loop lifts read-only before `undoDepthOf`, since Undo is refused too.
- `toggleLink`'s read-only return is `refuseIfReadOnly()`; its "both stay as they are" still holds.
- Its real key events in `markdown-editor-context-menu-mounted.test.ts` are on an editable editor and are not affected. The surface's `mousedown`, `click`, `auxclick` and `keydown` listeners do nothing while the editor is editable.
- Enter in a read-only editor asks `$readSelectionState().linkUrl` (`$linkUrlToFollowAtCaret`, in front of `WysiwygSurface`). If the plan changes where `linkUrl` reports a link, at a link's last character say, Enter follows there with no further change, and rows L17 and L21 hold the two together.
- `$linkHolding` in `markdownReadOnly.ts` and `$findEnclosingLinkNode` in `MarkdownEditor.ts` are one search written twice. If the plan gives link helpers a module of their own, both can go there.
