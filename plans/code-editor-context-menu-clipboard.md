---
depends-on:
  - clipboard-context-menu-foundation
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Context-Menu Clipboard Actions — Implementation Plan

## Overview

`CodeEditor` ([packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:280](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L280)) is the CodeMirror-6-backed code editor — a separate component from `MarkdownEditor`'s Lexical WYSIWYG surface, which already gained a right-click Cut/Copy/Paste menu in [`plans/implemented/markdown-editor-context-menu-clipboard.md`](plans/implemented/markdown-editor-context-menu-clipboard.md). `Body.init()` suppresses the browser's native right-click menu page-wide ([core/Body.ts:165](packages/lib/src/typescript/lib/core/Body.ts#L165)), which took away whatever native menu `CodeEditor`'s contenteditable host might otherwise have offered. `CodeEditor` today has no clipboard or context-menu code of its own — confirmed by `grep -n "contextmenu\|clipboard\|Cut\|Copy\|Paste" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`, zero matches. Keyboard Ctrl/Cmd+X/C/V still work, since CodeMirror handles those itself; only the right-click menu is missing.

This plan adds a right-click menu offering Cut, Copy, and Paste, backed by three new public command methods — `cut()`, `copy()`, `paste()` — implemented against CodeMirror's own `EditorState`/`EditorView` transaction API, not Lexical's. It reuses `buildClipboardMenuItems` from [`plans/clipboard-context-menu-foundation.md`](plans/clipboard-context-menu-foundation.md) (unmerged; this plan depends on it landing first) for the menu's three rows, and follows `MarkdownEditor`'s wiring shape only where CodeMirror's different DOM ownership and selection model don't force a different design.

One finding drives the riskiest part of this plan: `CodeEditor`'s `contextmenu` hook cannot use the same CodeMirror API its existing `beforeinput`/`paste`/`drop` hooks use, or it silently never fires once `Body`'s page-wide suppression is active. See `## Architecture Decisions`.

---

## Architecture Decisions

### `contextmenu` is wired through CodeMirror's own DOM-event system, not the framework's `Event` API

`CodeEditor`'s existing `beforeinput`/`paste`/`drop` hooks are registered via `EditorView.domEventHandlers` inside `mount()` ([CodeEditor.ts:1329-1338](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1329-L1338)), not via `Event.addListener`/`addSubtreeListener`.[^foreign-widget] The new `contextmenu` hook follows the same mechanism, registered on CodeMirror's own `contentDOM`.

### The `contextmenu` hook must be a `domEventObservers` entry, not a `domEventHandlers` one — the obvious choice silently never fires

`EditorView.domEventObservers({ contextmenu: (event, view) => this.handleContextMenu(event, view) })` is a **new, second** extension entry, added alongside the existing `domEventHandlers({...})` block — not a fourth key merged into that block. A `contextmenu` handler registered the same way `beforeinput`/`paste`/`drop` are would compile fine, pass every offline test, and then never once fire in a real browser.[^defaultprevented-trap]

### Cut / Copy / Paste act on the primary selection only

All three commands read and write `EditorState.selection.main` — CodeMirror's primary range — and ignore any secondary range from multi-cursor editing. The menu's `hasSelectedText` flag is `!view.state.selection.main.empty`, the same primary range.[^primary-only]

### Copy/Cut read `state.sliceDoc`; the OS clipboard goes through the existing DOM seam; document edits go through `view.dispatch`

`copy()` and `cut()` read `this._view.state.sliceDoc(main.from, main.to)` and write it with `DOM.sink.writeClipboardText` — the same seam `MarkdownEditor` already uses, since the OS clipboard is page-level, not element-specific. `cut()` additionally dispatches `{ changes: { from: main.from, to: main.to } }` to delete the range; `paste()` reads via `DOM.source.readClipboardText()` and dispatches an insert. No new `DOMSource`/`DOMSink` member is needed.

### Paste inserts the clipboard text verbatim — no newline/tab splitting

The dispatched change is `{ from: main.from, to: main.to, insert: text }`, with `text` used exactly as read from the clipboard.[^plain-text-model]

### A read-only editor's menu omits Cut and Paste; `cut()` and `paste()` themselves stay ungated

`buildContextMenuItems` passes `cut`/`paste` handlers to the shared `buildClipboardMenuItems` builder only when `!this.getReadOnly()`; when a handler is omitted, the builder leaves that row out of the menu entirely, per its own presence rule. Copy is never gated on `readOnly` — it doesn't edit the document. `cut()` and `paste()` do not check `getReadOnly()` internally.[^readonly-gate-only-menu]

| `readOnly` | `hasSelectedText` | Rows shown |
|---|---|---|
| `false` | `true` | Cut (enabled), Copy (enabled), Paste |
| `false` | `false` | Cut (disabled), Copy (disabled), Paste |
| `true` | `true` | Copy (enabled) |
| `true` | `false` | Copy (disabled) |

### The row-building step is split from the DOM-facing handler, for offline testability

`buildContextMenuItems(hasSelectedText: boolean)` is a private method taking a plain boolean and returning `MenuItemConfig[]`; `handleContextMenu(event, view)` is the thin wrapper that reads `hasSelectedText` off the live `view` and calls `this._contextMenu.show(...)`.[^split-precedent]

### One `Menu` instance, explicitly disposed

`CodeEditor` gets `private readonly _contextMenu: Menu = new Menu();`, shown via `.show(x, y, items)` on every right-click.[^menu-precedent] `destructor()` calls `this._contextMenu.dispose()` explicitly, since `Menu` is never registered via `addComponent` and the base class's child-recursion teardown cannot reach it.

### The denied-paste toast reuses `MarkdownEditor`'s exact message

`pasteFromContextMenu()` shows `Notification.show(CLIPBOARD_READ_DENIED_MESSAGE, "warning", CLIPBOARD_HINT_DURATION_MS)` on a failed read, with the identical message text and 6-second duration `MarkdownEditor` uses, declared as `CodeEditor.ts`'s own local module constants.[^duplicate-message]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/editor/CodeEditor.ts

/** Copies the primary selection's text to the system clipboard. No-op before the view is mounted, or when the primary selection is collapsed. */
copy(): this;

/** Copies the primary selection's text to the system clipboard, then removes it. No-op before the view is mounted, or when the primary selection is collapsed. */
cut(): this;

/**
 * Reads the system clipboard and inserts it at the primary selection,
 * replacing any selected text.
 *
 * @returns `true` when the clipboard was read (even if empty), `false` when
 *   there is no mounted view or the browser refused the read.
 */
paste(): Promise<boolean>;
```

New private members on `CodeEditor`: `_contextMenu: Menu` (backing field, no options entry, no setter), `buildContextMenuItems(hasSelectedText: boolean): MenuItemConfig[]`, `handleContextMenu(event: MouseEvent, view: EditorView): void`, `pasteFromContextMenu(): Promise<void>`.

New module-level constants in `CodeEditor.ts`, beside `READONLY_FLASH_COLOR`:

```typescript
const CLIPBOARD_READ_DENIED_MESSAGE = "Clipboard read blocked by the browser — press Ctrl/Cmd+V to paste.";
const CLIPBOARD_HINT_DURATION_MS = 6000;
```

`CodeEditorOptions` is unchanged, and no existing method's signature changes.

---

## Internal Structure

The three commands, placed after `moveCursorToEnd()` ([CodeEditor.ts:908-916](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L908-L916)) and before `format()`'s doc comment ([CodeEditor.ts:918](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L918)):

```typescript
copy(): this {
    if (!this._view) {
        return this;
    }

    const { main } = this._view.state.selection;

    if (!main.empty) {
        DOM.sink.writeClipboardText(this._view.state.sliceDoc(main.from, main.to));
    }

    return this;
}

cut(): this {
    this.copy();

    if (this._view) {
        const { main } = this._view.state.selection;

        if (!main.empty) {
            this._view.dispatch({ changes: { from: main.from, to: main.to }, scrollIntoView: true });
        }
    }

    return this;
}

async paste(): Promise<boolean> {
    if (!this._view) {
        return false;
    }

    const text = await DOM.source.readClipboardText();

    if (text === null) {
        return false;
    }

    // Re-checked after the await: the component may be destroyed (nulling
    // `_view`) while the clipboard read is in flight.
    if (text !== "" && this._view) {
        const { main } = this._view.state.selection;

        this._view.dispatch({
            changes:        { from: main.from, to: main.to, insert: text },
            selection:      { anchor: main.from + text.length },
            scrollIntoView: true,
        });
    }

    return true;
}
```

The menu field, placed directly after `_listeners` ([CodeEditor.ts:323](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L323)):

```typescript
/** Right-click Cut/Copy/Paste menu; rebuilt on every `show()` call. */
private readonly _contextMenu: Menu = new Menu();
```

The menu-building and DOM-facing methods, placed after `flashReadOnly()` ([CodeEditor.ts:1882-1894](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1882-L1894)), before the class's closing brace:

```typescript
private buildContextMenuItems(hasSelectedText: boolean): MenuItemConfig[] {
    const readOnly = this.getReadOnly();

    return buildClipboardMenuItems({
        hasSelectedText,
        cut:   readOnly ? undefined : () => this.cut(),
        copy:  () => this.copy(),
        paste: readOnly ? undefined : () => void this.pasteFromContextMenu(),
    });
}

private handleContextMenu(event: MouseEvent, view: EditorView): void {
    const hasSelectedText = !view.state.selection.main.empty;

    this._contextMenu.show(event.clientX, event.clientY, this.buildContextMenuItems(hasSelectedText));
}

private async pasteFromContextMenu(): Promise<void> {
    if (!await this.paste()) {
        Notification.show(CLIPBOARD_READ_DENIED_MESSAGE, "warning", CLIPBOARD_HINT_DURATION_MS);
    }
}
```

The new extension entry inside `mount()`, added directly after the existing `domEventHandlers` block ([CodeEditor.ts:1329-1338](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1329-L1338)) — the existing block is unchanged:

```typescript
EditorView.domEventHandlers({
    beforeinput: () => this.onEditIntent(),
    paste:       () => this.onEditIntent(),
    drop:        () => this.onEditIntent(),
}),
EditorView.domEventObservers({
    contextmenu: (event, view) => this.handleContextMenu(event, view),
}),
```

The disposal line in `destructor()`, added directly after `this._unsubscribeTheme();` ([CodeEditor.ts:1160](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1160)):

```typescript
// `Menu` is never registered via `addComponent` (see its own class comment),
// so the base class's child-recursion teardown cannot reach it.
this._contextMenu.dispose();
```

---

## Ordered Implementation Steps

1. **Add the four new imports** to [`CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts), directly after the `callable` import ([:9](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L9)):
   ```typescript
   import { Menu } from "~/overlay/Menu.js";
   import { MenuItemConfig } from "~/component/container/MenuItem.js";
   import { Notification } from "~/overlay/Notification.js";
   import { buildClipboardMenuItems } from "~/component/shared/buildClipboardMenuItems.js";
   ```
   *Check:* `npm run typecheck` still passes (all four resolve).

2. **Add the two module constants** from `## Public API`, directly after `READONLY_FLASH_COLOR` ([:224](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L224)).

3. **Write the clipboard-command tests (red).** In [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts), add a `describe('CodeEditor clipboard commands')` block. Follow the file's own `editor._view = { state: {...}, dispatch: dispatchSpy }` duck-typing convention (see the `'CodeEditor format() dispatch'` block, [:1878-1906](packages/lib/tests/component/code-editor.test.ts#L1878-L1906), for the shape) and the `RecordingDOMSink`/`vi.spyOn(DOM.source, 'readClipboardText')` idiom from `markdown-editor.test.ts`. Cover behaviours 1-12 of `## Expected Behaviour`.

4. **Implement `copy()`, `cut()`, and `paste()`** from `## Internal Structure`, placed after `moveCursorToEnd()`.
   *Check:* Step 3's tests go green.

5. **Add the `_contextMenu` field** from `## Internal Structure`, directly after `_listeners`.

6. **Write the context-menu tests (red).** In the same test file, add a `describe('CodeEditor context menu')` block covering behaviours 13-19: `buildContextMenuItems` called directly with a plain boolean and (via `setReadOnly`) both `readOnly` states; `handleContextMenu` called directly with a minimal fake `event`/`view` pair (`{ clientX, clientY } as MouseEvent`, `{ state: { selection: { main: { empty } } } } as EditorView`), spying on `(editor as any)._contextMenu.show`; `pasteFromContextMenu` with `DOM.source.readClipboardText` stubbed to `null` and to a real string, asserting on `Notification`'s history (mirroring `markdown-editor.test.ts`'s `Notification` static-clearing `beforeEach`/`afterEach`).

7. **Implement `buildContextMenuItems`, `handleContextMenu`, and `pasteFromContextMenu`** from `## Internal Structure`, placed after `flashReadOnly()`.
   *Check:* Step 6's tests go green.

8. **Wire the observer in `mount()`.** Add the new `EditorView.domEventObservers({...})` extensions-array entry directly after the existing `domEventHandlers({...})` block.
   *Check:* `grep -n "domEventObservers" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — exactly one match. `grep -n "domEventHandlers" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — still exactly one match (the pre-existing block, unchanged).

9. **Add the disposal line to `destructor()`**, directly after `this._unsubscribeTheme();`.
   *Check:* `npx vitest run tests/component/dispose-full-teardown.test.ts` — still green (the existing sweep at [:134](packages/lib/tests/component/dispose-full-teardown.test.ts#L134) already constructs and disposes a bare `CodeEditor`).

10. **Full check.** `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`, `npm run lint`, `npm run docs:api` (zero warnings).

11. **Docs.** Apply every edit in `## Documentation Impact`, per the `document` skill.

12. **Manual browser verification.** Behaviours 20-25 of `## Expected Behaviour`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No new files.

---

## Expected Behaviour

**Unit-testable — the commands** (`code-editor.test.ts`, `'CodeEditor clipboard commands'`, offline):

1. `copy()` records a `writeClipboardText` write carrying the primary selection's text when it is non-empty.
2. `copy()` records no write when the primary selection is collapsed.
3. `copy()` is a no-op (no write, no throw) when `_view` is `null`.
4. `cut()` records the write **and** dispatches `{ changes: { from, to } }` (no `insert`) matching the primary selection, when it is non-empty.
5. `cut()` records no write and dispatches nothing when the primary selection is collapsed.
6. `cut()` is a no-op when `_view` is `null`.
7. `paste()` resolves `false` and never calls `DOM.source.readClipboardText` when `_view` is `null`.
8. `paste()` resolves `false` and dispatches nothing when the clipboard read resolves `null`.
9. `paste()` resolves `true` and dispatches nothing when the clipboard read resolves `""`.
10. `paste()` resolves `true` and dispatches `{ changes: { from, to: from, insert: text }, selection: { anchor: from + text.length } }` when the primary selection is collapsed at `from`.
11. `paste()` resolves `true` and dispatches a replace (`from !== to`) with the same `selection.anchor` formula when the primary selection holds text.
12. A clipboard read of `"a\nb"` is dispatched as `insert: "a\nb"` verbatim — no splitting into separate change entries.

**Unit-testable — the menu** (`code-editor.test.ts`, `'CodeEditor context menu'`, offline):

13. `buildContextMenuItems(true)` on a non-read-only editor returns 3 rows — `Cut` (`enabled: true`), `Copy` (`enabled: true`), `Paste` (no `enabled` key) — in that order.
14. `buildContextMenuItems(false)` on a non-read-only editor returns the same 3 rows with `Cut`/`Copy` `enabled: false`.
15. `buildContextMenuItems(true)` on a read-only editor (`setReadOnly(true)`) returns exactly 1 row — `Copy`, `enabled: true`.
16. `buildContextMenuItems(false)` on a read-only editor returns exactly 1 row — `Copy`, `enabled: false`.
17. Each row's `action` calls the matching method exactly once (spy-verified): `Cut` → `cut()`, `Copy` → `copy()`, `Paste` → `pasteFromContextMenu()`.
18. `handleContextMenu(event, view)` calls `_contextMenu.show(event.clientX, event.clientY, items)` where `items` matches what `buildContextMenuItems(!view.state.selection.main.empty)` would build, for both selection states.
19. `pasteFromContextMenu()` shows one `Notification` (`"warning"`, `CLIPBOARD_READ_DENIED_MESSAGE`) when `paste()` resolves `false`, and none when it resolves `true`.

**Manual** (`npm run dev`, app on `localhost:8015`, the demo's CodeEditor panel):

20. Right-clicking inside code with a selection opens a menu leading with Cut/Copy/Paste; the browser's own native menu never appears — this confirms the `domEventObservers` wiring actually fires despite `Body`'s page-wide `preventDefault`.
21. Right-click with no selection dims Cut/Copy; Paste still works.
22. A `CodeEditor` constructed with `readOnly: true` shows only Copy on right-click.
23. Copy/Cut place real text on the OS clipboard (paste into another application to confirm); Cut removes it from the document.
24. Paste inserts real OS clipboard content at the caret, replacing a selection when one exists; in a browser that denies the read, the toast appears and Ctrl/Cmd+V still works.
25. With a multi-cursor selection active (e.g. via Ctrl+D), right-clicking and choosing Copy/Cut/Paste acts on the primary cursor only — confirms the Architecture Decision in practice.

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` — clean.
- `cd packages/lib && npx vitest run tests/component/code-editor.test.ts` — all green, including the new blocks.
- `npm test` — the whole suite, including `dispose-full-teardown.test.ts`.
- `npm run lint` — clean; `grep -rn "readClipboardText\|writeClipboardText" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` shows only the two DOM-seam calls added here, keeping `local/no-raw-dom` at its empty baseline (no raw `navigator.clipboard` is touched — the seam already exists).
- `npm run docs:api` — zero warnings.
- `npm run build:docs` — clean VitePress build.
- Manual behaviours 20-25.

---

## Documentation Impact

- **[`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md)**:
  - Insert a new `## Right-click menu` section directly after `## Keyboard` ([:159-180](packages/lib/docs/components/CodeEditor.md#L159-L180)), before `## Common methods` ([:181](packages/lib/docs/components/CodeEditor.md#L181)). State: right-click opens a menu with Cut, Copy, and Paste; Cut and Copy dim with nothing selected; a read-only editor (`readOnly: true`) shows only Copy; a browser that refuses the clipboard read shows a toast, and Ctrl/Cmd+V still works. Note that only the primary selection is acted on when multiple cursors are active.
  - Add three rows to the `## Common methods` table ([:183-200](packages/lib/docs/components/CodeEditor.md#L183-L200)): `cut()` / `copy()` ("Cut or copy the primary selection's text to the system clipboard."), `paste()` ("Read the system clipboard and insert it at the primary selection, replacing any selected text. Async: resolves `true` when the clipboard was read, `false` when there is no mounted view or the browser refused the read.").
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — add one bullet under `## Added` → `### Components`, directly after the existing `MarkdownEditor` clipboard bullet ([:142-147](packages/lib/docs/reference/changelog/next.md#L142-L147)), in the same style: `CodeEditor` gains `cut()` / `copy()` / `paste()` and a right-click menu leading with Cut/Copy/Paste (dimmed for Cut/Copy when nothing is selected; a read-only editor shows only Copy), acting on the primary selection only.
- **`CodeEditor.ts`'s own class doc comment** ([:242-279](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L242-L279)) — add one sentence noting the right-click Cut/Copy/Paste menu, keeping the rest of the `@remarks` block unchanged.
- **`packages/lib/llms.txt` needs no change** — generated from `scripts/llms/manifest.data.mjs`; it indexes capabilities and hard rules, neither of which this adds. Do not regenerate it.

---

## Potential Challenges

- **The `domEventObservers`-vs-`domEventHandlers` trap is silent offline.** Nothing in the offline test harness dispatches a real DOM event through `Body`'s window-capture listener and CodeMirror's own bubble-phase listener together, so a wrong choice here would pass every automated check and only fail live. Mitigation: Architecture Decision 2, verified against `@codemirror/view`'s own compiled source (see the footnote), plus manual behaviour 20, which specifically checks that the native menu is suppressed *and* the framework menu still appears.
- **`_view` can go `null` mid-`paste()`.** The component can be destroyed while `DOM.source.readClipboardText()`'s promise is still pending. Mitigated by re-checking `this._view` after the `await` before dispatching.
- **The offline harness cannot exercise a real `contextmenu` event, real multi-cursor input, or a real OS clipboard permission prompt.** `handleContextMenu` and `buildContextMenuItems` are tested via direct invocation with a duck-typed `view`/plain `boolean` instead (Architecture Decision "row-building split"); the real event pipeline, multi-cursor behaviour, and clipboard permissions are manual-verify only (behaviours 20, 24, 25).
- **A consumer with their own `DOMSource`/`DOMSink` is unaffected.** This plan adds no new seam member — `readClipboardText`/`writeClipboardText` already exist from earlier plans in this batch.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — the component being extended; read `mount()` (:1255-1428), `onEditIntent`/`signalReadOnlyEdit`/`flashReadOnly` (:1852-1894), and `destructor()` (:1154-1178) before editing.
- [`plans/clipboard-context-menu-foundation.md`](plans/clipboard-context-menu-foundation.md) — defines `buildClipboardMenuItems`/`ClipboardMenuConfig`, which this plan consumes without modification. Read in full; this plan must land after it.
- [`plans/implemented/markdown-editor-context-menu-clipboard.md`](plans/implemented/markdown-editor-context-menu-clipboard.md) — the wiring-shape precedent for the command API and the menu's toast-on-denied-paste behaviour.
- [`plans/implemented/markdown-editor-context-menu.md`](plans/implemented/markdown-editor-context-menu.md) — the classify/build split precedent (Architecture Decision "row-building split").
- [`plans/implemented/native-context-menu-suppression.md`](plans/implemented/native-context-menu-suppression.md) — why the native menu is gone, and the exact disposition (`{ prevent: true }`, never `stop`) `Body`'s handler returns.
- [`packages/lib/src/typescript/lib/core/Body.ts:150-243`](packages/lib/src/typescript/lib/core/Body.ts#L150) — `setNativeContextMenu`, `onContextMenu`; confirms the suppression is a page-wide, `preventDefault`-only, capture-phase listener.
- [`packages/lib/src/typescript/lib/core/Event.ts:183-186`](packages/lib/src/typescript/lib/core/Event.ts#L183-L186) — `captureOpts`, confirming every viewport listener (including `contextmenu`) registers with `capture: true`.
- [`packages/lib/src/typescript/lib/overlay/Menu.ts:297`](packages/lib/src/typescript/lib/overlay/Menu.ts#L297) — `Menu.show(x, y, items, onClose?, excludeEl?)`.
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts:53`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L53) — `MenuItemConfig`.
- [`packages/lib/src/typescript/lib/overlay/Notification.ts:261`](packages/lib/src/typescript/lib/overlay/Notification.ts#L261) — `Notification.show(message, type, duration)`.
- [`packages/lib/tests/component/code-editor.test.ts:1878-1906`](packages/lib/tests/component/code-editor.test.ts#L1878-L1906) and `:88-137` — the duck-typed `_view` dispatch-testing convention and the offline no-op convention this plan's new tests follow.
- [`packages/lib/tests/component/dispose-full-teardown.test.ts:134`](packages/lib/tests/component/dispose-full-teardown.test.ts#L134) — the existing generic dispose sweep that already covers `CodeEditor`, and will now also cover `_contextMenu`.

---

## Non-Goals

- **No changes to `MarkdownEditor`, the clipboard-context-menu foundation, or any other plan in this batch.**
- **No multi-range/multi-cursor clipboard support.** Decided in Architecture Decisions, not deferred: a native right-click cannot coherently address CodeMirror's secondary ranges, which have no representation in the browser's own selection.
- **No rich-content clipboard.** Copy writes plain text; Paste inserts plain text — matching `MarkdownEditor`'s own Non-Goal and CodeMirror's plain-text document model.
- **No shortcut hints or glyphs on the three rows** — same reasoning as `MarkdownEditor`'s Non-Goal (`Ctrl` vs `Cmd` is platform-dependent; the framework has no platform-detection helper).
- **No internal `readOnly` guard inside `cut()`/`paste()`.** Gating happens only at the menu (Architecture Decision "readOnly-gate-only-menu"); the command methods stay unconditional, like `setValue()`/`format()`.
- **No changes to CodeMirror's own native keyboard Ctrl+X/C/V handling, or to `EditorState.readOnly`'s semantics.**
- **No selection-expansion or capture/restore mechanism.** `MarkdownEditor`'s biggest complexity, needed only because its menu also carries format-toggle rows that widen a collapsed caret to a word. This menu carries no such rows, so there is nothing to guard a caret against.
- **No shared clipboard-message constant module.** The message string is duplicated locally in `CodeEditor.ts`, matching Simplicity First — a third consumer would be the point to extract one, not this plan.

---

## Notes

[^foreign-widget]: `CodeEditor`'s own class doc states it is a "foreign live widget" that "takes a real parent element and mutates a whole DOM region it owns directly," the same category as `Canvas`'s `CanvasRenderingContext2D` ([CodeEditor.ts:250-255](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L250-L255)). The framework's `Event` API is reserved for a component's own element (ARCHITECTURE.md, *A component must not listen to another component's events through `Event`*), and `contentDOM` is not `CodeEditor`'s own element — CodeMirror owns and re-renders it. `grep -n "Event\.\|addSubtreeListener\|addListener" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` returns zero matches today, confirming every existing DOM hook in this file already goes through CodeMirror's own `domEventHandlers`, not `Event`.

[^defaultprevented-trap]: `Body.init()` suppresses `contextmenu` via a **window-level, capture-phase** native listener (`Event.addViewportListener`, confirmed `capture: true` for every type by `captureOpts` at [`Event.ts:183-186`](packages/lib/src/typescript/lib/core/Event.ts#L183-L186)) that calls `preventDefault()` ([`Body.ts:241-243`](packages/lib/src/typescript/lib/core/Body.ts#L241)). A capture-phase listener on `window` always runs before any listener on a descendant node, including CodeMirror's own `contentDOM` — capture phase must finish traversing down to the target before the target/bubble phase can even begin. CodeMirror registers its `domEventHandlers`-configured listeners on `contentDOM` with `addEventListener(type, this.handleEvent, { passive })` — no `capture` flag, so bubble phase (`@codemirror/view/dist/index.js:4578-4584`, function `ensureHandlers`). By the time that bubble-phase listener runs, `event.defaultPrevented` is already `true`. CodeMirror's own internal dispatch loop for `domEventHandlers` explicitly bails out on that flag *before* calling any handler:
    ```javascript
    // @codemirror/view/dist/index.js:4565-4573, InputState.runHandlers
    for (let handler of handlers.handlers) {
        if (event.defaultPrevented) break;
        if (handler(this.view, event)) { event.preventDefault(); break; }
    }
    ```
    So a `contextmenu` handler registered via `domEventHandlers` — the same API `beforeinput`/`paste`/`drop` already use — would never be invoked once `Body`'s suppression is active. Those three existing hooks are unaffected: `Body` only suppresses `contextmenu`, a different event type, so `event.defaultPrevented` is never pre-set for them. `MarkdownEditor`'s `WysiwygSurface` also isn't affected, for a different reason: its `contextmenu` listener goes through the framework's own `Event.addSubtreeListener`, which is dispatched from *inside* the same single window-capture callback `Body`'s own listener runs in (ARCHITECTURE.md: "the `Event` class owns a single window-level capture handler per DOM event type") — both run synchronously within one native capture-phase call, before the browser's bubble phase (and CodeMirror's separate, real `addEventListener`) even begins.

    `EditorView.domEventObservers` sidesteps the trap entirely — its dispatch loop has no `defaultPrevented` check at all:
    ```javascript
    // @codemirror/view/dist/index.js:4562-4567, InputState.runHandlers
    for (let observer of handlers.observers) observer(this.view, event);
    ```
    This matches its documented contract exactly: "observers can't be prevented from running by a higher-precedence handler returning true... and should not call `preventDefault`" (`@codemirror/view/dist/index.js:8714-8719`, doc comment on `EditorView.domEventObservers`). We don't need to call `preventDefault` ourselves anyway — that is already `Body`'s job — so an observer's write-only contract is a strictly better fit than a handler's, not merely a workaround.

[^primary-only]: `CodeEditor`'s own extension list includes `drawSelection()` ([CodeEditor.ts:1278](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1278)), whose own doc comment states it "hides the browser's native selection and cursor, replacing the selection with a background behind the text... and the cursors with elements overlaid over the code... This allows the editor to display secondary selection ranges" (`@codemirror/view/dist/index.d.ts:1601-1611`). Secondary ranges are a purely internal CodeMirror rendering concept — most browsers cannot represent more than one `Range` in a `Selection` over editable content at all, so a native `contextmenu` event's own browser-level selection has no way to reflect them. There is accordingly no coherent way for a native right-click gesture to be understood as "acting on every range" the way a keyboard shortcut can.

    This is a real divergence from CodeMirror's own native Ctrl+C/Ctrl+X, confirmed by reading its compiled source: `handlers.copy = handlers.cut` (`@codemirror/view/dist/index.js:5199-5222`) calls `copiedRange(view.state)`, which joins the text of *every* non-empty range (`@codemirror/view/dist/index.js:5169-5188`), and falls back to a line-wise copy of the current line(s) when the whole selection is collapsed. The keyboard shortcut can do this because it calls CodeMirror's own internal command directly against its full internal state, with no native `Selection` object mediating "which range." A right-click has no such privileged access — its meaning is set by where the native event fires and what the native selection says, and that is the primary range only. The line-wise-copy-when-collapsed fallback specifically is moot for the menu regardless: Cut/Copy are already dimmed whenever `hasSelectedText` is `false` (the shared builder's own rule, decided in `plans/clipboard-context-menu-foundation.md`), so a disabled row can never trigger it.

[^plain-text-model]: `MarkdownEditor`'s `paste()` calls `RangeSelection.insertRawText(text)` specifically because Lexical's document is a node tree where a plain text node cannot itself contain a line break — `insertRawText` splits the clipboard text on `\n`/`\t` into text/line-break/tab nodes before inserting (see that plan's `[^insert-raw-text]`). CodeMirror's document (`@codemirror/state`'s `Text`) has no such distinction: it is intrinsically a plain-text, line-based structure, and `state.toText(input)` (used internally by CodeMirror's own paste handler, `@codemirror/view/dist/index.js:4903-4906`) turns any string into a correctly-lined `Text` with no special handling. A `ChangeSpec`'s `insert` field accepts a plain `string`, and inserting one containing `\n`/`\t` characters produces the correct lines/literal tabs by construction. There is no "rich vs. plain" axis at the document level to guard against at all.

[^readonly-gate-only-menu]: `EditorState.readOnly`'s own doc comment states its actual contract: "This facet controls the value of the `readOnly` getter, which is *consulted by* commands and extensions that implement editing functionality to determine whether they should apply" (`@codemirror/state/dist/index.js:2902-2907`, emphasis added) — it is advisory, not enforced at the transaction level. `EditorView.dispatch`'s default `dispatchTransactions` path (`@codemirror/view/dist/index.js:7908-7910, 7933-7937`) applies any transaction unconditionally; only CodeMirror's own built-in commands and DOM input handlers (`beforeinput`, `paste`, `drop`, `cut` — all of which explicitly check `view.state.readOnly` before acting, e.g. `@codemirror/view/dist/index.js:5138-5139`) choose to respect it. `CodeEditor.ts`'s own `setValue()` ([:493-503](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L493-L503)) and `format()`/`applyFormatted()` already dispatch document-changing transactions with no `readOnly` check at all — by design, since a host's own programmatic control over content is a different concern from a user's editing gesture. `cut()`/`paste()` are the same category of programmatic command as those two, so this plan gates only the one new UI surface it adds (the menu), rather than duplicating a check inside methods whose un-gated-ness is already this file's own established convention. A consumer calling `codeEditor.cut()` directly on a read-only instance bypasses the menu's gate on purpose, exactly as calling `setValue()` on a read-only instance already does.

[^split-precedent]: `plans/implemented/markdown-editor-context-menu.md`'s *Classification is a pure function, split from the untestable DOM-resolution step* decision is the direct precedent: `$getNearestNodeFromDOMNode` only resolves against a real, mounted DOM tree the offline harness never builds, so that plan split a pure `$classifyContextMenuTarget` from a thin `handleWysiwygContextMenu` wrapper. `CodeEditor` needs no DOM-node resolution at all — CodeMirror hands the live `EditorState` directly to any `domEventObservers` callback — so the split here is narrower: it separates "test with a plain `boolean`" from "test with a fake `event`/`view` pair," rather than "test with a resolved node" from "test with a real DOM target." The underlying reason is the same: the DOM-facing half cannot be exercised by the offline harness (no real `contextmenu` event ever fires under the recording sink), but the item-building half can.

[^menu-precedent]: `Table._columnContextMenu`/`showColumnMenu`/`showCellMenu` ([Table.ts:1711-1778](packages/lib/src/typescript/lib/component/table/Table.ts#L1711-L1778)) and `MarkdownEditor._contextMenu` both reuse one `Menu` field across every right-click, on the reasoning that `Menu.show()` fully rebuilds its item list on every call and only one context menu is ever open at a time. `CodeEditor` has only one context — there's no "which context" question at all — so the precedent applies even more directly here than it did for either of them.

[^duplicate-message]: `plans/clipboard-context-menu-foundation.md` factored out the menu-item-shape builder (`buildClipboardMenuItems`) but not a shared message string — `MarkdownEditor`'s toast text is a local module constant in `MarkdownEditor.ts`, not an exported one. Duplicating the two-line constant here keeps the user-visible wording identical across every editor in this batch without introducing a new shared module for two string literals, matching Simplicity First. If a third editor in this batch needs the same message, extracting a shared constant becomes worth its own small plan; it is not yet, with only two consumers.
