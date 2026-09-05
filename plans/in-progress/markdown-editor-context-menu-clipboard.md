---
depends-on:
  - markdown-editor-context-menu
touches-shared:
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/docs/concepts/dom-seams.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Context-Menu Clipboard Actions — Implementation Plan

## Overview

`MarkdownEditor`'s right-click context menu ([packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts:1262](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1262)) offers inline-format toggles, block styles, and table row/column commands, but nothing for the clipboard. This plan adds **Cut**, **Copy**, and **Paste** to all three of its contexts (word/selection text, table cell, empty line), backed by three new public command methods (`cut()`, `copy()`, `paste()`).

Copy and Cut ride on machinery that already exists: `DOM.sink.writeClipboardText(text)` ([packages/lib/src/typescript/lib/core/DOM.ts:679](packages/lib/src/typescript/lib/core/DOM.ts#L679)) is the framework's clipboard-write seam, used today by `TableBody.copySelectionToClipboard()` ([packages/lib/src/typescript/lib/component/table/Body.ts:1783](packages/lib/src/typescript/lib/component/table/Body.ts#L1783)). Paste needs two new things: a clipboard **read** on the DOM seam (none exists), and a way to paste at the caret the user actually right-clicked at rather than at the whole word the menu's existing expansion selects.

That expansion is the crux. `$selectEnclosingWordIfCollapsed()` ([MarkdownEditor.ts:261](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L261)) widens a collapsed right-click to the enclosing word so a format toggle has something to act on. Pasting over that widened selection would silently destroy a word the user never selected, so the right-click handler captures the pre-expansion selection and Paste restores it first. Every other menu action keeps using the expanded selection exactly as today.

**Base branch: `feature/markdown-editor-context-menu`, not `master`.** That branch's work is unmerged, and this plan edits the code it added. Create the implementation worktree from its tip:[^base-branch]

```
git worktree add .worktrees/markdown-editor-context-menu-clipboard \
    -b feature/markdown-editor-context-menu-clipboard feature/markdown-editor-context-menu
```

---

## Architecture Decisions

### The clipboard read goes on `DOMSource`, not `DOMSink`

`DOMSource` gains one member — `readClipboardText(): Promise<string | null>` — implemented in `ProductionDOMSource` and in the tests' `ModelledDOMSource`. The seam is split by direction, not by subsystem, so a clipboard read belongs with the reads even though its write twin sits on the sink.[^read-seam]

### A denied read resolves `null`; it never rejects

`readClipboardText()` catches the browser's rejection inside the seam and resolves `null` for "no clipboard read available" — a missing `navigator.clipboard`, a denied permission, a browser that refuses the read for page scripts. An empty clipboard resolves `""`, which is a different answer from `null`. The capability check living in the seam mirrors `ProductionDOMSource.matchMedia` ([DOM.ts:2347](packages/lib/src/typescript/lib/core/DOM.ts#L2347)), which degrades to an inert result rather than making every call site guard its environment.[^null-not-reject]

### Cut, Copy, and Paste become public command methods

`cut()` and `copy()` return `this` like every other command; `paste()` returns `Promise<boolean>` — `true` when the clipboard was read (even if it was empty), `false` when the read was unavailable. Each no-ops without throwing when there is no range selection, matching the contract the other commands already document.[^public-api]

### Paste inserts plain text through `insertRawText`

`RangeSelection.insertRawText(text)` splits the clipboard text on newlines and tabs into line-break and tab nodes; `insertText` does not. It is what Lexical's own plain-text paste path calls.[^insert-raw-text]

### The pre-expansion selection is captured per right-click and restored only for Paste

`handleWysiwygContextMenu` stores `$getSelection()?.clone()` in a private `_contextMenuSelection` field **before** calling `$selectEnclosingWordIfCollapsed()`, overwriting it on every right-click. Only the Paste item restores it, through `$setSelection`, immediately before pasting. A per-right-click private field holding the menu's target mirrors `Body._contextMenuCell` ([Body.ts:335](packages/lib/src/typescript/lib/component/table/Body.ts#L335)), which `Body.copyContextMenuSelection()` consumes the same way when the menu item fires. The field is internal bookkeeping, so it stays off the options bag per ARCHITECTURE.md's third DOM-write rule.

### The restore is guarded against a stale node key

A captured selection names Lexical node keys. The format-toggle rows leave the menu open, and applying a format splits and merges text nodes — so by the time Paste runs, a captured key may name a node that no longer exists, and restoring onto it throws. The restore checks both point keys with `$getNodeByKey` and skips itself when either is gone, pasting at the document's current selection instead.[^clone-guard]

### All three contexts get all three items; Cut and Copy dim when nothing is selected

`ContextMenuTarget` gains a `hasSelectedText: boolean` on all three variants, computed in `$classifyContextMenuTarget` from the **post-expansion** selection. Cut and Copy carry `enabled: hasSelectedText`; Paste is always enabled. The classification carrying the state the builders need — rather than the builders reading the live selection — is the shape the existing format fields already use, and it is what keeps the builders offline-testable.[^clipboard-block-everywhere]

| Right-click lands on | Selection after word expansion | `hasSelectedText` | Cut / Copy | Paste inserts at |
|---|---|---|---|---|
| Inside the word `beta` in `alpha beta`, nothing dragged | `beta` selected | `true` | enabled, act on `beta` | the caret inside `beta` — `alpha be‸ta` → `alpha beXta` |
| A space between two words | still a collapsed caret | `false` | dimmed | that caret |
| A drag-selection covering `alpha beta` | unchanged | `true` | enabled, act on `alpha beta` | replaces `alpha beta` |
| An empty line | collapsed caret, empty paragraph | `false` | dimmed | that empty line |
| Two table cells drag-selected (a Lexical table selection, not a range) | table selection | `false` | dimmed | nothing — Paste no-ops |

### A denied paste shows a toast; the command API stays silent

The context-menu Paste handler shows `Notification.show(...)` when `paste()` resolves `false`; `paste()` itself reports failure only through its return value. The self-wired menu owns its own user feedback, exactly as it owns the word expansion, while the command API stays a thin wire-through for a consumer's own toolbar.[^toast]

### No shortcut hints, no glyphs on the new items

The three items carry `text` and `action` only. `MenuItemConfig` supports both `shortcut` and `glyph`, and neither is used.[^no-shortcut-hints]

### The commands target the WYSIWYG state in both modes

`cut()` / `copy()` / `paste()` call `ensureEditor()` and act on the Lexical state, with no `getMode()` branch — the same as `toggleBold`, `setBlockType`, and every other command. In source mode CodeMirror handles the clipboard itself.[^no-mode-branch]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/DOM.ts — added to the DOMSource interface,
// implemented by ProductionDOMSource (and by ModelledDOMSource in the test harness).
readClipboardText(): Promise<string | null>;
```

```typescript
// packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
cut(): this;
copy(): this;
paste(): Promise<boolean>;
```

```typescript
// Widened: hasSelectedText added to all three variants.
export type ContextMenuTarget =
    | { kind: "table-cell"; hasSelectedText: boolean; bold: boolean; italic: boolean; strikethrough: boolean; code: boolean }
    | { kind: "empty-line"; hasSelectedText: boolean }
    | { kind: "text";       hasSelectedText: boolean; bold: boolean; italic: boolean; strikethrough: boolean; code: boolean };
```

New private members on `MarkdownEditor`: `_contextMenuSelection: RangeSelection | null` (backing field, no options entry, no setter), `buildClipboardMenuItems(hasSelectedText)`, `restoreContextMenuSelection()`, `pasteAtContextMenuSelection()`.

New module-level constants in `MarkdownEditor.ts`, beside `HISTORY_DELAY_MS`:

```typescript
const CLIPBOARD_READ_DENIED_MESSAGE = "Clipboard read blocked by the browser — press Ctrl/Cmd+V to paste.";

/**
 * How long the clipboard-denied toast stays up (ms). Twice Notification's 3 s
 * default because this message asks the user to do something rather than just
 * reporting an outcome; 6 s is the duration the notifications recipe uses for
 * a `"warning"`.
 */
const CLIPBOARD_HINT_DURATION_MS = 6000;
```

---

## Internal Structure

`ProductionDOMSource.readClipboardText`, placed after its `getDocumentSelection` ([DOM.ts:2329](packages/lib/src/typescript/lib/core/DOM.ts#L2329)):

```typescript
/** @inheritDoc */
async readClipboardText(): Promise<string | null> {
    try {
        return (await navigator.clipboard?.readText()) ?? null;
    } catch {
        return null;
    }
}
```

`ModelledDOMSource.readClipboardText`, placed after its `getDocumentSelection` ([packages/lib/tests/dom/TestDOM.ts:1129](packages/lib/tests/dom/TestDOM.ts#L1129)):

```typescript
/** No system clipboard offline; always reports the read as unavailable. */
readClipboardText(): Promise<string | null> {
    return Promise.resolve(null);
}
```

The three commands on `MarkdownEditor`, placed after `clearFormatting()` ([MarkdownEditor.ts:943](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L943)):

```typescript
copy(): this {
    const text = this.ensureEditor().read(() => $getSelection()?.getTextContent() ?? "");

    // Guarded: writing "" would clobber the clipboard with nothing.
    if (text !== "") {
        DOM.sink.writeClipboardText(text);
    }

    return this;
}

cut(): this {
    this.copy();

    this.ensureEditor().update(() => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
            selection.removeText();   // a no-op on a collapsed selection
        }
    }, { discrete: true });

    return this;
}

async paste(): Promise<boolean> {
    const text = await DOM.source.readClipboardText();

    if (text === null) {
        return false;
    }

    if (text !== "") {
        this.ensureEditor().update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                selection.insertRawText(text);
            }
        }, { discrete: true });
    }

    return true;
}
```

The capture, inside `handleWysiwygContextMenu`'s existing `editor.update` callback, between the `node === null` early return and the `$selectEnclosingWordIfCollapsed()` call ([MarkdownEditor.ts:1271-1280](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1271-L1280)):

```typescript
const selection = $getSelection();

// Captured before the expansion below: Paste must land on the caret the user
// right-clicked at, not on the word the expansion selects for the format
// toggles. Overwritten on every right-click, so it can never go stale across
// two menu openings.
this._contextMenuSelection = $isRangeSelection(selection) ? selection.clone() : null;
```

The restore and the menu's paste handler:

```typescript
private restoreContextMenuSelection(): void {
    const captured = this._contextMenuSelection;

    if (captured === null) {
        return;
    }

    this.ensureEditor().update(() => {
        // A format toggle activated from this same open menu (those rows leave
        // the menu open) splits and merges text nodes, so a captured key can
        // name a node that no longer exists; restoring onto it throws.
        if ($getNodeByKey(captured.anchor.key) === null || $getNodeByKey(captured.focus.key) === null) {
            return;
        }

        $setSelection(captured.clone());
    }, { discrete: true });
}

private async pasteAtContextMenuSelection(): Promise<void> {
    this.restoreContextMenuSelection();

    if (!await this.paste()) {
        Notification.show(CLIPBOARD_READ_DENIED_MESSAGE, "warning", CLIPBOARD_HINT_DURATION_MS);
    }
}
```

The shared item builder, placed beside `buildFormatToggleItems` ([MarkdownEditor.ts:1314](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1314)):

```typescript
private buildClipboardMenuItems(hasSelectedText: boolean): MenuItemConfig[] {
    return [
        { text: "Cut",   enabled: hasSelectedText, action: () => this.cut() },
        { text: "Copy",  enabled: hasSelectedText, action: () => this.copy() },
        { text: "Paste", action: () => void this.pasteAtContextMenuSelection() },
    ];
}
```

Each of the three existing builders opens with `...this.buildClipboardMenuItems(context.hasSelectedText), { separator: true },` before its current first entry. `buildEmptyLineContextMenuItems` takes the `"empty-line"` context as a parameter for the same reason — see Step 5.

---

## Ordered Implementation Steps

1. **Add the clipboard read to the DOM seam.**
   - [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — declare `readClipboardText(): Promise<string | null>` in the `DOMSource` interface directly after `getDocumentSelection()` ([DOM.ts:1142](packages/lib/src/typescript/lib/core/DOM.ts#L1142)), with JSDoc stating that `null` means the read was unavailable or denied and `""` means an empty clipboard. Implement it in `ProductionDOMSource` after that class's own `getDocumentSelection` (see Internal Structure).
   - [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — implement it on `ModelledDOMSource` after its `getDocumentSelection` ([TestDOM.ts:1129](packages/lib/tests/dom/TestDOM.ts#L1129)).
   - Verify: `npm run typecheck` and `npm -w packages/lib run typecheck:test` both pass. These are the only two implementations of the interface in the repo — `grep -rn "implements DOMSource" packages/lib/src packages/lib/tests` returns exactly those two lines.

2. **Write the command-API tests (red).** In [`packages/lib/tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts), add a `describe('MarkdownEditor clipboard commands')` block after the existing `'MarkdownEditor command API'` block (line 276). Assert clipboard writes with the idiom [`Body.test.ts:1041`](packages/lib/tests/component/table/Body.test.ts#L1041) already uses — `(DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText')` — and stub reads with `vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(...)`. Cover behaviours 1-8 of **Expected Behaviour**. Add `$setSelection` to the file's `lexical` import.

3. **Implement `copy()`, `cut()`, and `paste()`** in [`MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) (see Internal Structure), placed after `clearFormatting()`. Add `$setSelection` and `$getNodeByKey` to the file's value import from `lexical` and `RangeSelection` to its `import type` line ([MarkdownEditor.ts:15-21](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L15-L21)). Verify: Step 2's tests go green.

4. **Widen the classification.**
   - `MarkdownEditor.ts` — add `hasSelectedText: boolean` to all three `ContextMenuTarget` variants ([MarkdownEditor.ts:226-229](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L226-L229)) and compute it in `$classifyContextMenuTarget` beside the existing `formatState`: `const hasSelectedText = $isRangeSelection(selection) && selection.getTextContent() !== "";`. Return it from all three branches.
   - Update the six existing `toEqual` assertions in `describe('$classifyContextMenuTarget')` ([markdown-editor.test.ts:794-889](packages/lib/tests/component/markdown-editor.test.ts#L794-L889)). Three cases establish no selection of their own; give each an explicit `lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });` before the classify call so the expected value follows from the contract rather than from whatever the Markdown import happened to leave behind.[^test-selection-explicit] Expected values: the *ordinary prose* case `false`; the *bold via `$selectAll`* case `true`; the *empty paragraph* case `false`; the *populated table cell* case `false`; the *empty table cell after `insertTable`* case `false` (the caret is collapsed); the *table + `$selectAll` + `toggleBold`* case `true`. **If an actual value disagrees with the expectation above, stop and report it rather than editing the expectation** — a disagreement means `hasSelectedText` is not computing what this plan says it computes.
   - Update the eight `buildContextMenuItems({ … })` literals in `describe('MarkdownEditor context menu')` ([markdown-editor.test.ts:1003-1135](packages/lib/tests/component/markdown-editor.test.ts#L1003-L1135)) to include `hasSelectedText: true`, and the existing item-count and item-order assertions to account for the new leading block (see behaviours 9-11).
   - Verify: `npm run typecheck` is clean and the classification tests pass.

5. **Wire the menu items.**
   - `MarkdownEditor.ts` — add the `_contextMenuSelection` field beside `_contextMenu` ([MarkdownEditor.ts:613](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L613)), the capture line inside `handleWysiwygContextMenu`, `buildClipboardMenuItems`, `restoreContextMenuSelection`, `pasteAtContextMenuSelection`, and the two module constants (all in Internal Structure).
   - Prefix each of `buildTextContextMenuItems`, `buildTableCellContextMenuItems`, and `buildEmptyLineContextMenuItems` with the clipboard block plus a separator. `buildEmptyLineContextMenuItems` currently takes no parameter — give it `context: ContextMenuTarget & { kind: "empty-line" }` and pass the context through from `buildContextMenuItems` ([MarkdownEditor.ts:1295-1301](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1295-L1301)), matching the other two branches.
   - Add `import { Notification } from "~/overlay/Notification.js";` beside the existing `~/overlay/Menu.js` import.
   - Add the tests for behaviours 9-15, reaching `_contextMenuSelection`, `restoreContextMenuSelection`, and `pasteAtContextMenuSelection` through the same `as unknown as { … }` white-box cast the file's `contextMenuMethodsOf` helper already uses ([markdown-editor.test.ts:91](packages/lib/tests/component/markdown-editor.test.ts#L91)). Include a `beforeEach`/`afterEach` that clears `Notification`'s private statics exactly as [`NotificationHistory.test.ts:25-28`](packages/lib/tests/overlay/NotificationHistory.test.ts#L25-L28) does — a toast left in the static queue breaks a later test's restack under a freshly installed sink.
   - Verify: the whole file is green — `cd packages/lib && npx vitest run tests/component/markdown-editor.test.ts`.

6. **Full check.** `npm test`, `npm run lint`, `npm run docs:api` (must finish with zero warnings).

7. **Manual browser verification** — the offline harness cannot exercise a real `contextmenu` event, a real OS clipboard, or a real permission prompt. Run the checks under **Expected Behaviour → Manual**.

8. **Docs.** See **Documentation Impact**, after Steps 1-7 are green, per the `document` skill.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No new files. `packages/lib/src/typescript/MarkdownEditorPanel.ts` (the demo) needs no change — the menu is self-wired, so right-clicking the live demo exercises the new items immediately.

---

## Expected Behaviour

**Unit-testable** (offline, under the recording sink):

1. `copy()` with `hello world` fully selected records exactly one `writeClipboardText` write carrying `"hello world"`.
2. `copy()` with a collapsed caret records no `writeClipboardText` write at all.
3. `cut()` with `world` selected records the write **and** leaves `getValue()` without `world`.
4. `cut()` with a collapsed caret records no write and leaves `getValue()` unchanged.
5. `paste()` with the read stubbed to `"X"` and a collapsed caret inside a document resolves `true` and inserts `X` at the caret.
6. `paste()` with the read stubbed to `"X"` and `world` selected resolves `true` and replaces `world` with `X`.
7. `paste()` with the read stubbed to `null` resolves `false` and leaves `getValue()` unchanged.
8. `paste()` with the read stubbed to `""` resolves `true` and leaves `getValue()` unchanged. With the selection explicitly cleared (`$setSelection(null)`), a `"X"` read resolves `true` and still inserts nothing.
9. A `"text"` context builds 12 entries: `Cut`, `Copy`, `Paste`, separator, the four format checkbox rows, separator, `Block style`, separator, `Clear formatting`.
10. A `"table-cell"` context builds 13 entries: the same three plus a separator, then the nine entries it builds today.
11. An `"empty-line"` context builds 9 entries: the same three plus a separator, then `Heading`, `Quote`, `Code block`, separator, `Table`.
12. `Cut` and `Copy` carry `enabled: false` when the context's `hasSelectedText` is `false`, and `enabled: true` when it is `true`, in all three contexts. `Paste` never sets `enabled`.
13. The restore is what decides the paste target. With `alpha beta`, a collapsed caret inside `beta`, the pre-expansion selection captured into `_contextMenuSelection`, and `$selectEnclosingWordIfCollapsed()` then run: `pasteAtContextMenuSelection()` with the read stubbed to `"X"` yields `alpha beXta`, while calling `paste()` directly (no restore) yields `alpha X`.
14. `restoreContextMenuSelection()` does not throw when the captured selection's nodes are gone — capture a selection, replace the document with `setValue`, then call it; the following `paste()` still inserts at the current selection.
15. A `paste()` that resolves `false` through the menu path appends one `Notification` history record whose message is `CLIPBOARD_READ_DENIED_MESSAGE` and whose type is `"warning"`; a successful paste appends none.

**Manual** (dev server on `localhost:8015` via `npm run dev`, the demo app's **MD Editor** section):

- Right-click a word without selecting anything, choose **Copy**, then paste into another application — the whole word arrives.
- Same, but **Cut** — the word is removed from the document and the OS clipboard holds it.
- Right-click inside a word (`alpha be‸ta`), choose **Paste**, grant the permission if prompted — the clipboard text lands at the caret and the word survives (`alpha beXta`), which is the behaviour the whole capture/restore mechanism exists for.
- Drag-select several words, right-click inside the selection, **Paste** — the selection is replaced.
- Right-click an empty line — **Cut** and **Copy** are dimmed, **Paste** inserts there.
- Right-click a table cell — all three appear above the format toggles and act on the cell's text.
- In a browser that refuses or denies the read, **Paste** shows the toast and Ctrl/Cmd+V still works.
- Open the menu, toggle **Bold** (the menu stays open), then choose **Paste** — no error, and the text lands somewhere sensible in the same paragraph.

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` — clean.
- `cd packages/lib && npx vitest run tests/component/markdown-editor.test.ts` — the new cases plus every pre-existing case in the file.
- `npm test` — the whole suite, which also covers the two seam implementations.
- `npm run lint` — no new `local/no-raw-dom` findings; `navigator.clipboard` appears only inside `core/DOM.ts`. Confirm with `grep -rn "navigator.clipboard" packages/lib/src` — expect hits in `core/DOM.ts` only.
- `npm run docs:api` — zero warnings.
- Manual checks above.

---

## Documentation Impact

- **[`packages/lib/docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md)** — add two rows to the **Command API** table: `cut()` / `copy()` ("Write the selected text to the system clipboard; `cut()` also removes it") and `paste()` ("Read the system clipboard and insert it at the caret, replacing any selection. Async: resolves `true` when the clipboard was read, `false` when the browser would not allow the read"). Add a short paragraph after the table on the clipboard-read permission and the fallback toast. Extend the **Right-click context menu** bullet under *Formatting* to say every context leads with Cut / Copy / Paste, that Cut and Copy are disabled with nothing selected, and that Paste targets the original caret rather than the auto-selected word.
- **`MarkdownEditor.ts` class JSDoc** — add the three methods to the command list in the `@remarks` block ([MarkdownEditor.ts:536-542](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L536-L542)). Describe the seam behaviour in prose; do not `{@link}` it (CODE_CONVENTIONS.md).
- **[`packages/lib/docs/concepts/dom-seams.md`](packages/lib/docs/concepts/dom-seams.md)** — the *Why two interfaces* section says reads are synchronous. Add the exception in one clause: `readClipboardText()` is the seam's one asynchronous read, because the browser API it wraps has no synchronous form.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — add a `### Core` subsection at the end of `## Breaking changes`, worded like the 0.7.0 entry it mirrors ([0.7.0.md:11](packages/lib/docs/reference/changelog/0.7.0.md#L11)): "`DOMSource` gains one required member: `readClipboardText()`. Only a consumer implementing its own `DOMSource` is affected." Add a `### Components` bullet under `## Added` for `MarkdownEditor`'s `cut()` / `copy()` / `paste()` and the context-menu entries.
- **`packages/lib/llms.txt` needs no change** — it is generated from `scripts/llms/manifest.data.mjs`, and `MarkdownEditor`'s one-line summary there is unaffected. Do not regenerate it.

---

## Potential Challenges

- **A captured selection can go stale while the menu is open.** The format rows keep the menu open and re-split text nodes; the `$getNodeByKey` guard in `restoreContextMenuSelection` skips the restore instead of throwing.
- **A denied clipboard read is normal, not exceptional.** Browsers differ — some prompt once, some require a per-paste confirmation, some refuse the read for page scripts entirely. The `null` result and the toast are the designed path, not an error path.
- **The `ContextMenuTarget` widening breaks existing test literals.** That is a compile error listing every site; Step 4 enumerates them.
- **`Notification`'s static queue and history survive a test.** Clear both in the new describe block, as `NotificationHistory.test.ts` does.
- **The right-click handler itself stays offline-untestable.** `$getNearestNodeFromDOMNode` resolves nothing when no view is mounted, so tests drive `_contextMenuSelection` and the private paste path directly; the real `contextmenu` event stays manual-verify, as it already is for this menu.
- **A `MenuItemConfig.action` returning a promise would float.** `void this.pasteAtContextMenuSelection()` is the fire-and-forget idiom the codebase already uses (`TreeTablePanel.ts:88`, `Markdown.ts:1208`).

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — the component; read `$selectEnclosingWordIfCollapsed`, `$classifyContextMenuTarget`, `handleWysiwygContextMenu`, and the four builders before editing.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — the seam; `writeClipboardText` (:679, :1808) is the write twin, `getDocumentSelection` (:1142, :2329) the page-level-read precedent, `matchMedia` (:2347) the capability-check-in-the-seam precedent.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `copySelectionToClipboard` / `copyContextMenuSelection` (:1783, :1796) and `_contextMenuCell` (:335): the clipboard-write and per-right-click-state precedents.
- [`packages/lib/src/typescript/lib/component/table/Table.ts:1776`](packages/lib/src/typescript/lib/component/table/Table.ts#L1776) — the existing context-menu Copy item.
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts:53`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L53) — `MenuItemConfig`, for `enabled` semantics.
- [`packages/lib/src/typescript/lib/overlay/Notification.ts:261`](packages/lib/src/typescript/lib/overlay/Notification.ts#L261) — `Notification.show(message, type, duration)`.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `RecordingDOMSink` (:388) and `ModelledDOMSource` (:875).
- [`packages/lib/tests/component/table/Body.test.ts:1041`](packages/lib/tests/component/table/Body.test.ts#L1041) — the clipboard-write assertion idiom.
- [`packages/lib/tests/overlay/NotificationHistory.test.ts`](packages/lib/tests/overlay/NotificationHistory.test.ts) — how a toast is asserted offline and how its statics are cleared.
- [`plans/implemented/markdown-editor-context-menu.md`](plans/implemented/markdown-editor-context-menu.md) — the plan this one builds on; its Architecture Decisions explain the menu's shape.

---

## Non-Goals

- **Rich-content clipboard.** Copy writes plain text and Paste inserts plain text. Preserving formatting across the clipboard would mean HTML flavours and the `@lexical/clipboard` package, which is not a dependency of this library.
- **Source-mode clipboard commands.** CodeMirror handles Cut/Copy/Paste natively in the source surface, and the context menu exists only on the WYSIWYG surface.
- **Read-only gating.** The context menu already offers editing commands over a read-only editor; Cut and Paste inherit that pre-existing gap unchanged. Fixing it is a separate change across every item in the menu.
- **Keyboard shortcuts.** Ctrl/Cmd+X/C/V are the browser's and Lexical's own and are untouched.
- **Multi-cell table-selection cut/copy.** A Lexical table selection is not a range selection; Cut and Copy dim there.
- **A `clipboardText` knob on `installTestDOM`.** `vi.spyOn(DOM.source, 'readClipboardText')` is the established way to vary a seam read per test.
- **Undo/Redo menu entries.** Unrelated to the clipboard; add them with their own plan if wanted.

---

## Implementation Notes

**`copy()`'s Internal Structure snippet contradicted this plan's own Architecture Decision, and the contradiction shipped as a bug caught only by audit.** The `## Architecture Decisions` section states plainly: "Each no-ops without throwing when there is no range selection" (the "Cut, Copy, and Paste become public command methods" entry), and `## Expected Behaviour`'s classification table and `## Non-Goals`'s "Multi-cell table-selection cut/copy" entry both say a table (grid) selection is not a range selection and Cut/Copy must dim/no-op there. But the `## Internal Structure` code block for `copy()` reads `$getSelection()?.getTextContent() ?? ""` with no `$isRangeSelection` guard — and `TableSelection.getTextContent()` (the type `$getSelection()` returns for a multi-cell drag-selection) happily concatenates every selected cell's text. Implemented literally, `copy()` copied a multi-cell table selection to the clipboard, and `cut()` — which calls `copy()` then separately guards its own `removeText()` with `$isRangeSelection` — silently degraded to a copy-only operation instead of the documented no-op, contradicting the menu's own `hasSelectedText` dimming (which correctly reports `false` for a table selection) and the public command API it wires to.

Fixed by reading the selection inside `copy()`'s own guard, matching `cut()`'s existing one:

```typescript
copy(): this {
    const text = this.ensureEditor().read(() => {
        const selection = $getSelection();

        return $isRangeSelection(selection) ? selection.getTextContent() : "";
    });
    // …
}
```

A regression test (`'copy() and cut() record no write for a multi-cell table selection, which is not a range selection'`, `markdown-editor.test.ts`) builds a real `TableSelection` via `@lexical/table`'s `$createTableSelectionFrom` and asserts zero clipboard writes from both `copy()` and `cut()`. Found and fixed during the audit loop, not at initial implementation — the Internal Structure snippet was followed as written, per this skill's own instruction to honour the plan's prescribed code, and the mismatch was a plan defect rather than an implementer choice.

**The capture/restore design (`## Internal Structure`'s "The pre-expansion selection is captured per right-click and restored only for Paste", and behaviours 13-14) shipped a genuine UX bug, caught only by live user testing.** `handleWysiwygContextMenu`, implemented exactly as specified, called `$selectEnclosingWordIfCollapsed()` unconditionally before the menu was even built — mutating the live Lexical selection, so a right-click on a collapsed caret inside a word visibly highlighted that whole word in the contenteditable surface for as long as the menu stayed open. `_contextMenuSelection` captured the selection *before* that mutation specifically so Paste could restore it and land on the original caret instead of the highlighted word — meaning the UI's own visible selection lied about what Paste would do: it looked like Paste would replace the highlighted word, but it never did.

Fixed by making classification read-only instead of mutate-then-classify: `$selectEnclosingWordIfCollapsed()` was split into a pure query (`$computeWordExpansion()`, computing the offsets/format bitmask a collapsed caret would expand to) and the original mutating action, now built on top of it. `$classifyContextMenuTarget` calls only the pure query, so a right-click never touches the document's selection, and `handleWysiwygContextMenu` reverted to `editor.read()`. Each action that actually needs the wider selection — `toggleBold`/`toggleItalic`/`toggleStrikethrough`/`toggleInlineCode`, `cut`, and `copy` — now performs the mutating expansion itself, immediately before its own work, so the menu's checkbox/Cut+Copy-enabled state always matches what activating that item will do. `paste()` no longer captures or restores anything: it acts on whatever selection is live at the moment it's invoked, which — since nothing upstream mutates on open — is the user's actual untouched caret unless a format toggle (or Cut/Copy) already ran earlier in the same still-open menu. `_contextMenuSelection`, `restoreContextMenuSelection()`, and the stale-`$getNodeByKey` guard (footnote below) are gone entirely — they existed only to fight the eager mutation this fix removes. `## Expected Behaviour`'s items 13-14 and the third **Manual** bullet above describe the superseded capture/restore contract and are left as the historical record of what was originally specified and implemented (matching how the unguarded `copy()` snippet above stays uncorrected in `## Internal Structure`); `markdown-editor.test.ts` replaces the two tests behind items 13-14 with tests pinning the corrected contract instead (a right-click leaves the selection collapsed and unmutated; a bare `paste()` lands at the untouched caret; a format toggle invoked first, followed by `paste()`, replaces the now-expanded selection), and this fix was live-verified in the browser in place of the superseded manual bullet.

---

## Notes

[^base-branch]: The frontmatter spec (`~/.claude/skills/_shared/plan-frontmatter.md`) has fields for plan dependencies and shared files, but none for a base branch. `depends-on: [markdown-editor-context-menu]` is nonetheless literally true and does the right thing: that plan sits in `plans/implemented/` on `feature/markdown-editor-context-menu` and nowhere else, so the dependency is satisfied exactly when the worktree is cut from that branch and unsatisfied when it is cut from `master`. The explicit `git worktree add` command in the Overview is the operative instruction; the frontmatter is the machine-readable echo of it. Do not rebase this work onto `master` first — every line it edits in `MarkdownEditor.ts` was added by that branch.

[^read-seam]: `docs/concepts/dom-seams.md` opens with the organising rule: every DOM *write* funnels through one interface and every *read* through the other. The seam already splits several same-subsystem pairs across the two interfaces for exactly that reason — `setValue`/`getValue`, `setScrollLeft`/`getScrollLeft`, `setLocationHash`/`getLocationHash` — so `writeClipboardText` living on the sink is not an argument for putting its read twin there. `getDocumentSelection()` is the closest existing member: a page-level read taking no handle and returning plain data. The one genuine divergence is that `readClipboardText` is the seam's first `Promise`-returning member, and the same doc's *Why two interfaces* section describes reads as synchronous. The browser API has no synchronous form, so the alternative is not a synchronous read but no seam member at all; the asynchrony also sits more comfortably on the read side of the doc's own worker-transport argument, where "reads must round-trip" anyway. `Documentation Impact` corrects the doc sentence rather than leaving it contradicted.

[^null-not-reject]: The alternative — letting the browser's rejection propagate — was rejected on two counts. Offline, `ModelledDOMSource` would have to return a rejected promise for a call every paste path makes, so any test that touched paste without a stub would produce an unhandled rejection. And the rejection reason is not actionable: `NotAllowedError`, a missing `navigator.clipboard`, and a browser that never grants page scripts the read all lead to the same single fallback. `null` versus `""` keeps the one distinction that does matter — refused versus empty — so a consumer can tell "nothing to paste" from "we were not allowed to look".

[^public-api]: Every item in this menu already calls through to a public command method (`toggleBold`, `setBlockType`, `deleteTable`, …), and `MarkdownEditor.md` documents that surface as the way a consumer wires their own toolbar — a toolbar with Cut/Copy/Paste buttons being the obvious case. `TableBody.copySelectionToClipboard()` is public for the same reason. `paste()` cannot return `this` because it must be awaited; `CodeEditor.format(): Promise<void>` is the sibling precedent for an async command method on an editor component. It returns `boolean` rather than rejecting so the menu's `void`-called handler cannot produce an unhandled rejection, and so a consumer gets the one bit they need without a `try`/`catch`.

[^insert-raw-text]: `RangeSelection.insertRawText(text)` is `insertNodes($generateNodesFromRawText(text))`, which turns `\n` into line-break nodes and `\t` into tab nodes; `insertText(text)` puts the raw characters into a single text node. Lexical's own event path calls `insertRawText` when it has plain text and no rich payload (`node_modules/lexical/dist/Lexical.dev.mjs:4716`). `@lexical/markdown`'s exporter already handles line-break nodes, so a multi-line paste round-trips through `getValue()` without a special case.

[^clone-guard]: The window is real, not theoretical: `buildFormatToggleItems` builds `CheckboxMenuRow`s, which leave the menu open on activation precisely so several formats can be toggled in one right-click. `RangeSelection.formatText` splits and merges text nodes, and the pre-expansion caret's node key can be among the removed ones. Restoring a point onto a removed key throws inside `editor.update`, which would surface as a hard error from a menu click. Checking both point keys with `$getNodeByKey` before `$setSelection` costs two map lookups and degrades to "paste where the document's selection is now", which is what a user who just applied a format to that word would expect anyway. Capturing raw `{key, offset, type}` tuples instead of a `clone()` was considered and rejected: it has the identical staleness problem plus manual reconstruction, while `clone()` + `$setSelection` is what Lexical itself does internally (`Lexical.dev.mjs:4604`).

[^clipboard-block-everywhere]: The alternative was to omit Cut and Copy from the empty-line context, where a caret on an empty line has nothing to act on. It was rejected because it is both a special case to carry and wrong in one real situation: a drag-selection that ends on an empty line classifies as `"empty-line"` while a genuine selection exists, and omitting the items would hide Cut and Copy exactly when they work. Dimming instead of hiding is also the platform convention — right-clicking blank space in any desktop editor shows greyed Cut and Copy. Computing the flag in `$classifyContextMenuTarget` rather than in the builders keeps the builders pure functions of their argument, which is what makes them assertable offline (`handleWysiwygContextMenu` itself cannot run offline, since no view is mounted for a DOM target to resolve against).

[^toast]: `Notification.show` is the framework's toast primitive and `docs/recipes/notifications.md` documents pairing it with a context-menu action; `"warning"` is its documented severity for "a non-blocking issue the user should notice", which a denied read with a working keyboard fallback is. This is the first call from framework code rather than from the demo app — the import layering is already established, since `MarkdownEditor` imports `~/overlay/Menu.js` from the same package. The two alternatives were `console.warn`, the framework's convention for developer-facing faults but invisible to the user who just clicked Paste and saw nothing happen, and silence, which is the same thing without the log line. `paste()` itself stays silent so a consumer wiring their own Paste button gets to write their own message instead of getting one they did not ask for.

[^no-shortcut-hints]: `MenuItemConfig.shortcut` renders a right-aligned hint, and the demo's MenuBar Edit menu uses it for exactly these three commands. It is skipped here because the correct hint is platform-dependent (`Ctrl` versus `Cmd`) and the framework has no platform-detection helper — the docs write "Ctrl/Cmd+B" in prose precisely because of that — so any fixed string would be wrong for half the users. Inventing platform detection for three menu hints is out of proportion to the benefit. Glyphs are skipped for a plainer reason: no item in this component's menu carries one today.

[^no-mode-branch]: `getValue`, `setValue`, and `focus` branch on `getMode()`; no command method does. Following the commands keeps one rule for the whole command API ("commands act on the rich-text document"), and the practical consequence in source mode is nil — CodeMirror's own clipboard handling is what a user reaches there, and a mode switch back to WYSIWYG re-converts from the source text, discarding any stray state edit.

[^test-selection-explicit]: `$convertFromMarkdownString` may or may not leave a selection behind, and the answer is an implementation detail of the Markdown importer rather than something this feature specifies. Pinning the selection explicitly in each case makes the expected `hasSelectedText` follow from the contract — "true when the selection holds text" — instead of from observed behaviour that a Lexical upgrade could change silently.
