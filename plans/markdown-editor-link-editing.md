---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
---

# Markdown Editor Link Editing — Implementation Plan

## Overview

`MarkdownEditor`'s WYSIWYG surface can already toggle a link on or off a selection via the public `toggleLink(url)` command ([MarkdownEditor.ts:1006-1018](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1006-L1018)), but there is no way to reach that command from the WYSIWYG surface itself, and no way to edit an existing link's URL at all — the only path today is switching to source mode and hand-editing `[text](url)`. This plan adds **Insert link**, **Edit link**, and **Remove link** to the right-click context menu ([MarkdownEditor.ts:1476-1482](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1476-L1482)) that already hosts formatting toggles, block-style/insert submenus, table row/column commands, and Cut/Copy/Paste, using [`Dialog`](packages/lib/docs/components/Dialog.md)'s custom-content pattern to collect the URL.

Links are Lexical's own `LinkNode` from `@lexical/link` (`node_modules/@lexical/link/src/LexicalLinkNode.ts:75`, a third-party dependency — cited by path, not linked), already registered in `EDITOR_NODES` ([editorNodes.ts:5,28](packages/lib/src/typescript/lib/component/editor/editorNodes.ts#L28)) and already round-tripped by the curated `LINK` transformer ([markdownTransformers.ts:13,55-67](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L55-L67)), which exports `[${text}](${node.getURL()})` reading the live URL — no changes to `markdownTransformers.ts` are needed. The work is entirely in `MarkdownEditor.ts`: classification gains a `linkUrl` field, `toggleLink(url)` gains a small enhancement, and one new public method (`removeLink()`) is added.

This plan's file citations for `MarkdownEditor.ts` assume the current master snapshot. `plans/markdown-editor-insert-line-around-block.md` (drafted separately, not yet implemented) touches several of the same regions — see [Potential Challenges](#potential-challenges).

---

## Architecture Decisions

### `linkUrl` is a new field on the existing classification, not a new `ContextMenuTarget` kind

`ContextMenuTarget`'s `"table-cell"` and `"text"` variants ([MarkdownEditor.ts:238-241](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L238-L241)) already carry `bold`/`italic`/`strikethrough`/`code` — a link co-exists with those the same way, so it becomes a fourth carried field, `linkUrl?: string | null` (the URL when the click resolves inside a link, else `null`), typed **optional** rather than required.[^optional-field] `"empty-line"` is untouched — an empty paragraph can never contain a link, since `LinkNode.canBeEmpty()` is `false`.

### `toggleLink(url)` is reused, enhanced, for both Insert and Edit; `removeLink()` is new

Tracing Lexical's own `$toggleLink` (`node_modules/@lexical/link/src/LexicalLinkNode.ts:731-921`) shows it already updates a link's URL **in place** when the selection resolves entirely inside one existing link — collapsed or not — rather than double-wrapping or no-op'ing.[^toggle-link-trace] So both **Insert** and **Edit** call the same public `toggleLink(url)`, which gets one small addition: expand a collapsed caret to its enclosing word first (mirroring `toggleBold`/`toggleItalic`/etc.'s existing pattern), but only when `url !== null` — expansion is irrelevant to a removal.

**Remove** cannot reuse bare `toggleLink(null)` unmodified: on a *partial* range selection inside a link, Lexical's own collapsed-vs-range branching only unwraps the selected portion (`$splitLinkAtSelection`), leaving the rest of the link intact — not "unwraps it back to plain text" for the whole link, which is what this feature asks for regardless of how much of the link happens to be selected. `removeLink()` is a new public method: it collapses the selection to the start of the enclosing link first (`LinkNode.selectStart()`), which routes `$toggleLink(null)` through its collapsed-selection branch — the one that always unwraps the *entire* link.

### Insert Link needs a selection or an expandable word; no bare-caret two-field prompt

Insert Link is enabled exactly when `hasSelectedText` is true — the same field Cut/Copy already use, computed the same way (a real selection, or what a collapsed caret's enclosing-word expansion would select). A completely bare caret with no adjacent word (e.g. two spaces, or after punctuation) leaves the item present but disabled, matching Cut/Copy's own precedent, rather than opening a second prompt for placeholder link text.[^bare-caret-rejected]

### The Dialog "prompt" is the existing custom-content pattern

This codebase has **no `Dialog.prompt()`** — `Dialog`'s public surface is `show`/`confirm`/`info`/`success`/`warning`/`error` ([Dialog.ts:1430-1557](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1430-L1557)); "One-shot prompt" in `Dialog.md` refers to a confirm/cancel message dialog, not a text-input prompt. The established way to collect one string value is `Dialog.show({ contentComponent: <TextField>, buttons: [...] })`, reading the field's value after the promise resolves `'confirm'` — documented under "Custom content" in `Dialog.md`'s own doc-sample form, and used for real (not just as a doc sample) in `Table.showColumnDialog` ([Table.ts:1865-1904](packages/lib/src/typescript/lib/component/table/Table.ts#L1865-L1904)), which builds the equivalent `new Dialog(config)` / `dialog.show()` instance form because it needs to hold onto the instance afterward (to null out a field on close); this plan has no such need, so it uses the plain static `Dialog.show(config)` form, matching `Dialog.md`'s own example exactly. A private `promptForLinkUrl` helper builds this: a bare `TextField` pre-filled with a default URL, `Cancel`/`Confirm` buttons, no `initialFocus` override (the field is already the dialog's only, and therefore default, focusable element).

### Classification stays read-only; expansion happens lazily, inside each action

`$findEnclosingLinkNode`'s read for `linkUrl` never mutates the selection, and `toggleLink`'s new expansion call runs only inside `toggleLink` itself — never during classification.[^read-only-precedent]

---

## Public API

```typescript
// Existing signature, behavior extended (see Architecture Decisions):
toggleLink(url: string | null): this;

// New:
removeLink(): this;
```

No other exported symbols change. `promptForLinkUrl`, `promptAndApplyLink`, `buildLinkMenuItems`, and `$findEnclosingLinkNode` are all private/module-internal.

---

## Internal Structure

### `$findEnclosingLinkNode` — shared by classification and `removeLink`

Insert after `$findEnclosingSeparatorTarget` ([MarkdownEditor.ts:167-177](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L167-L177)):

```typescript
/**
 * Finds the link enclosing `node`, if any — checking `node` itself first,
 * then its ancestors, stopping at the document root.
 *
 * @param node - The node to search from (typically a selection anchor, or
 *   the right-click's resolved DOM-target node).
 * @returns The enclosing `LinkNode`, or `null` when `node` sits in neither.
 */
function $findEnclosingLinkNode(node: LexicalNode): LinkNode | null {
    return $findMatchingParent(node, $isLinkNode);
}
```

### `ContextMenuTarget` — new field

At [MarkdownEditor.ts:238-241](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L238-L241):

```typescript
export type ContextMenuTarget =
    | { kind: "table-cell"; hasSelectedText: boolean; linkUrl?: string | null; bold: boolean; italic: boolean; strikethrough: boolean; code: boolean }
    | { kind: "empty-line"; hasSelectedText: boolean }
    | { kind: "text"; hasSelectedText: boolean; linkUrl?: string | null; bold: boolean; italic: boolean; strikethrough: boolean; code: boolean };
```

### `$classifyContextMenuTarget` — compute and include `linkUrl`

At [MarkdownEditor.ts:374-398](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L374-L398), add one `const` and thread it into both non-empty-line returns:

```typescript
export function $classifyContextMenuTarget(node: LexicalNode): ContextMenuTarget {
    const selection = $getSelection();
    const expansion = $computeWordExpansion();
    const hasFormat = (type: TextFormatType): boolean => expansion !== null
        ? (expansion.format & TEXT_TYPE_TO_FORMAT[type]) !== 0
        : $isRangeSelection(selection) && selection.hasFormat(type);
    const formatState = {
        bold: hasFormat("bold"), italic: hasFormat("italic"),
        strikethrough: hasFormat("strikethrough"), code: hasFormat("code"),
    };
    const hasSelectedText = expansion !== null
        || ($isRangeSelection(selection) && selection.getTextContent() !== "");
    const linkUrl = $findEnclosingLinkNode(node)?.getURL() ?? null;

    if ($getTableCellNodeFromLexicalNode(node) !== null) {
        return { kind: "table-cell", hasSelectedText, linkUrl, ...formatState };
    }

    const block = $findMatchingParent(node, (n) => $isElementNode(n) && !n.isInline());

    if ($isParagraphNode(block) && block.getTextContent() === "") {
        return { kind: "empty-line", hasSelectedText };
    }

    return { kind: "text", hasSelectedText, linkUrl, ...formatState };
}
```

This is a pure read (`$findMatchingParent` + `getURL()`) — no selection mutation, preserving the read-only contract described above.

### `toggleLink` — lazy word-expansion for non-null URLs

At [MarkdownEditor.ts:1006-1018](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1006-L1018):

```typescript
/**
 * Wraps the current selection in a link to `url`, or unwraps it when `url`
 * is `null`. A collapsed caret first expands to its enclosing word (see
 * `$selectEnclosingWordIfCollapsed`) when `url` is non-null, so wrapping a
 * bare caret links just that word rather than the whole enclosing text run.
 * When the selection already sits inside one existing link, updates that
 * link's URL in place instead of double-wrapping (Lexical's own `$toggleLink`
 * behavior). No-op without a range selection.
 *
 * @param url - The link target, or `null` to remove the link.
 * @returns This component, for method chaining.
 */
toggleLink(url: string | null): this {
    const editor = this.ensureEditor();

    editor.update(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
            return;
        }

        if (url !== null) {
            $selectEnclosingWordIfCollapsed();
        }

        $toggleLink(url);
    }, { discrete: true });

    return this;
}
```

### `removeLink` — new command, always removes the whole link

Insert directly after `toggleLink` (so the two link commands stay adjacent):

```typescript
/**
 * Removes the link enclosing the current selection, unwrapping it back to
 * plain text and keeping the text content — the whole link, regardless of
 * how much of it (if any) is currently selected. No-op (without throwing)
 * when there is no range selection, or it is not inside a link.
 *
 * @returns This component, for method chaining.
 */
removeLink(): this {
    const editor = this.ensureEditor();

    editor.update(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
            return;
        }

        const linkNode = $findEnclosingLinkNode(selection.anchor.getNode());

        if (linkNode === null) {
            return;
        }

        // Collapsing inside the link first routes $toggleLink(null) through
        // its collapsed-selection branch, which always unwraps the whole
        // link — its range-selection branch only unwraps the selected
        // portion (see Architecture Decisions).
        linkNode.selectStart();
        $toggleLink(null);
    }, { discrete: true });

    return this;
}
```

### Dialog prompt + menu-action helpers

Insert after `pasteAtContextMenuSelection` ([MarkdownEditor.ts:1458-1468](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1458-L1468)):

```typescript
/**
 * Prompts for a URL via a `Dialog`: a bare `TextField` pre-filled with
 * `defaultUrl`, Cancel/Confirm buttons — this codebase's established
 * text-input-prompt pattern (see Architecture Decisions), since `Dialog` has
 * no dedicated prompt method. Enter confirms, since the field is the
 * dialog's only (and therefore default) focusable element.
 *
 * @param title - The dialog's title-bar text.
 * @param defaultUrl - The field's initial text — `""` for Insert, the
 *   link's current URL for Edit.
 * @returns The trimmed URL the user confirmed, or `null` on Cancel/close, or
 *   an empty/whitespace-only confirmation.
 */
private async promptForLinkUrl(title: string, defaultUrl: string): Promise<string | null> {
    const field = new TextField({ text: defaultUrl, placeholder: "https://example.com" });

    const result = await Dialog.show({
        title,
        contentComponent: field,
        buttons: [DialogButtons.Cancel, { ...DialogButtons.Confirm, primary: true }],
    });

    if (result !== "confirm") {
        return null;
    }

    const url = field.getValue().trim();

    return url === "" ? null : url;
}

/**
 * The context menu's Insert link / Edit link handler: prompts for a URL
 * (see `promptForLinkUrl`), then applies it via `toggleLink`. No-op when the
 * user cancels, submits an empty URL, or resubmits `defaultUrl` unchanged
 * (a real no-op for Edit; for Insert, `defaultUrl` is always `""`, which
 * `promptForLinkUrl` never returns, so this check is a no-op there).
 *
 * @param title - Forwarded to `promptForLinkUrl`.
 * @param defaultUrl - Forwarded to `promptForLinkUrl`.
 */
private async promptAndApplyLink(title: string, defaultUrl: string): Promise<void> {
    const url = await this.promptForLinkUrl(title, defaultUrl);

    if (url !== null && url !== defaultUrl) {
        this.toggleLink(url);
    }
}
```

### `buildLinkMenuItems` — shared by the text and table-cell menus

Insert after `buildClipboardMenuItems` ([MarkdownEditor.ts:1527-1533](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1527-L1533)):

```typescript
/**
 * Builds the link item(s) shared by the text and table-cell context menus:
 * "Insert link…" when the click is not inside a link (dimmed unless there
 * is a selection or expandable word to wrap), or "Edit link…" plus "Remove
 * link" when it is. The two states are mutually exclusive, so exactly one
 * of these shapes is ever shown — never a permanently-disabled item.
 *
 * @param context - Carries `linkUrl` (`undefined`/`null` outside a link, the
 *   URL inside one) and `hasSelectedText`.
 * @returns One or two `MenuItemConfig` entries.
 */
private buildLinkMenuItems(context: { linkUrl?: string | null; hasSelectedText: boolean }): MenuItemConfig[] {
    const linkUrl = context.linkUrl ?? null;

    if (linkUrl === null) {
        return [{
            text: "Insert link…", enabled: context.hasSelectedText,
            action: () => void this.promptAndApplyLink("Insert link", ""),
        }];
    }

    return [
        { text: "Edit link…", action: () => void this.promptAndApplyLink("Edit link", linkUrl) },
        { text: "Remove link", action: () => this.removeLink() },
    ];
}
```

The rule this builds, worked:

| `linkUrl` | `hasSelectedText` | Menu shows |
| --- | --- | --- |
| `null` / `undefined` | `true` | "Insert link…" (enabled) |
| `null` / `undefined` | `false` | "Insert link…" (disabled) |
| a URL string | `true` or `false` | "Edit link…" + "Remove link" (both always enabled) |

### Wiring into the two menu builders

At [MarkdownEditor.ts:1545-1568](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1545-L1568), `buildTextContextMenuItems` gains one spread, right after the format toggles:

```typescript
private buildTextContextMenuItems(context: ContextMenuTarget & { kind: "text" }): MenuItemConfig[] {
    return [
        ...this.buildClipboardMenuItems(context.hasSelectedText),
        { separator: true },
        ...this.buildFormatToggleItems(context),
        { separator: true },
        ...this.buildLinkMenuItems(context),
        { separator: true },
        {
            text:    "Block style",
            submenu: { /* unchanged */ },
        },
        { separator: true },
        { text: "Clear formatting", action: () => this.clearFormatting() },
    ];
}
```

At [MarkdownEditor.ts:1605-1637](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1605-L1637), `buildTableCellContextMenuItems` gains the same spread in the same relative position:

```typescript
private buildTableCellContextMenuItems(context: ContextMenuTarget & { kind: "table-cell" }): MenuItemConfig[] {
    return [
        ...this.buildClipboardMenuItems(context.hasSelectedText),
        { separator: true },
        ...this.buildFormatToggleItems(context),
        { separator: true },
        ...this.buildLinkMenuItems(context),
        { separator: true },
        { text: "Clear formatting", action: () => this.clearFormatting() },
        { separator: true },
        { text: "Insert", submenu: { /* unchanged */ } },
        { text: "Delete", submenu: { /* unchanged */ } },
    ];
}
```

Neither `buildEmptyLineContextMenuItems` nor its caller changes.

---

## Ordered Implementation Steps

1. **Imports** ([MarkdownEditor.ts:22,27](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L22)) — add `$isLinkNode` to the existing `import { $toggleLink } from "@lexical/link";` line; add a new `import type { LinkNode } from "@lexical/link";` line right after it. Add `import { TextField } from "~/component/input/TextField.js";` after the `CodeEditorChange` type import ([MarkdownEditor.ts:15](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L15)). Add `import { Dialog, DialogButtons } from "~/overlay/Dialog.js";` before the existing `Menu` import ([MarkdownEditor.ts:10](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L10)), keeping the overlay imports alphabetical.
2. **Add `$findEnclosingLinkNode`** per Internal Structure, after `$findEnclosingSeparatorTarget`.
   Check: `grep -n 'findEnclosingSeparatorTarget\|handleSeparatorShortcut' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` still shows the same two functions, unchanged.
3. **Widen `ContextMenuTarget`** per Internal Structure — add `linkUrl?: string | null` to the `"table-cell"` and `"text"` members only.
4. **Update `$classifyContextMenuTarget`** per Internal Structure — compute `linkUrl` and include it in both non-empty-line returns.
5. **Modify `toggleLink`** per Internal Structure — add the `if (url !== null) { $selectEnclosingWordIfCollapsed(); }` line inside the existing `editor.update` callback, before `$toggleLink(url)`.
6. **Add `removeLink()`** per Internal Structure, directly after `toggleLink`.
7. **Add `promptForLinkUrl` and `promptAndApplyLink`** per Internal Structure, directly after `pasteAtContextMenuSelection`.
8. **Add `buildLinkMenuItems`** per Internal Structure, directly after `buildClipboardMenuItems`.
9. **Wire `buildLinkMenuItems`** into `buildTextContextMenuItems` and `buildTableCellContextMenuItems` per Internal Structure.
10. **Update the class-level doc comment's command list** ([MarkdownEditor.ts:601-603](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L601-L603)) — insert `` `removeLink` `` right after `` `toggleLink` ``.
11. **Update existing tests that assert `$classifyContextMenuTarget`'s exact output** — add `linkUrl: null` to the `toEqual` literals at [markdown-editor.test.ts:1005-1007](packages/lib/tests/component/markdown-editor.test.ts#L1005-L1007), [:1024-1026](packages/lib/tests/component/markdown-editor.test.ts#L1024-L1026) (`"text"` kind), [:1058-1060](packages/lib/tests/component/markdown-editor.test.ts#L1058-L1060), [:1074-1076](packages/lib/tests/component/markdown-editor.test.ts#L1074-L1076), [:1095-1097](packages/lib/tests/component/markdown-editor.test.ts#L1095-L1097) (`"table-cell"` kind), and [:1457-1459](packages/lib/tests/component/markdown-editor.test.ts#L1457-L1459) (the read-only regression test).
12. **Update the two hard-coded item-count/order tests** in the "MarkdownEditor context menu" `describe` block — see the exact new layouts in Expected Behaviour below:
    - `'a "text" context builds 12 entries…'` ([markdown-editor.test.ts:1250-1263](packages/lib/tests/component/markdown-editor.test.ts#L1250-L1263)) becomes two tests (one per `linkUrl` state), 14 and 15 entries.
    - `'a "table-cell" context returns 13 entries…'` ([markdown-editor.test.ts:1330-1354](packages/lib/tests/component/markdown-editor.test.ts#L1330-L1354)) becomes two tests, 15 and 16 entries.
    - The other context-menu tests that build a `"text"`/`"table-cell"` context by hand ([markdown-editor.test.ts:1239,1253,1268,1288,1303,1333,1361,1383-1386](packages/lib/tests/component/markdown-editor.test.ts#L1239)) need **no change** — `linkUrl` is optional, so these untouched literals still typecheck and still classify as "not in a link".
13. **Add `.removeLink()` to the "all commands no-throw" chain** ([markdown-editor.test.ts:286-298](packages/lib/tests/component/markdown-editor.test.ts#L286-L298)), and add `.toggleLink('https://example.com')`'s sibling calls if useful for coverage (optional — the existing `toggleLink` calls in that chain already cover the modified code path).
14. **Add new tests** per Expected Behaviour below.
15. **Update `packages/lib/docs/components/MarkdownEditor.md`**: the "Formatting" section's context-menu paragraph ([MarkdownEditor.md:67](packages/lib/docs/components/MarkdownEditor.md#L67)), and the "Command API" table ([MarkdownEditor.md:69-84](packages/lib/docs/components/MarkdownEditor.md#L69-L84)) — reword the `toggleLink(url)` row and add a `removeLink()` row.
16. **Add a changelog entry** to `packages/lib/docs/reference/changelog/next.md`, under "## Added" → "### Components", alongside the existing Cut/Copy/Paste bullet.
17. **Typecheck and test.** Run the project's typecheck and `packages/lib/tests/component/markdown-editor.test.ts`; then `npm run docs:api` and confirm zero warnings (no new public JSDoc `{@link}`s an excluded symbol).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No files created or deleted; `markdownTransformers.ts` and `editorNodes.ts` are unchanged (verified: the `LINK` transformer already exports `node.getURL()` live, and `LinkNode` is already registered).

---

## Expected Behaviour

Unit-testable headlessly (mirroring the existing `describe('$classifyContextMenuTarget', …)` and `describe('MarkdownEditor context menu', …)` blocks):

1. `$classifyContextMenuTarget` returns `linkUrl: 'https://example.com'` when the resolved node sits inside `[text](https://example.com)`, for both a `"text"` node and a node inside a table cell — new tests mirroring [markdown-editor.test.ts:993-1008](packages/lib/tests/component/markdown-editor.test.ts#L993-L1008) and [:1044-1061](packages/lib/tests/component/markdown-editor.test.ts#L1044-L1061), seeding via `editor.setValue('A [link](https://example.com) in prose.')`.
2. Computing `linkUrl` does not mutate the selection — add a new sibling test in the same `describe('MarkdownEditor context-menu paste target', …)` block, right after the existing one ([markdown-editor.test.ts:1433-1470](packages/lib/tests/component/markdown-editor.test.ts#L1433-L1470)), following the exact same shape but seeding `editor.setValue('A [link](https://example.com) in prose.')` and collapsing the caret inside the link text instead of `'alpha beta'`: assert (a) `$classifyContextMenuTarget` returns `linkUrl: 'https://example.com'`, wrapped in `editor.read()` (not `.update()`, which throws on any mutation attempt — the same "strongest available guarantee" the existing test already uses), and (b) the selection is still collapsed at the original offset afterward. Leave the existing `'alpha beta'` test untouched, only adding `linkUrl: null` to its `toEqual` per step 11.
3. `buildContextMenuItems` for `{ kind: 'text', linkUrl: null, hasSelectedText: true, ... }` includes "Insert link…" with `enabled: true`, and has no "Edit link…"/"Remove link". With `hasSelectedText: false`, "Insert link…" has `enabled: false`.
4. `buildContextMenuItems` for `{ kind: 'text', linkUrl: 'https://x', hasSelectedText: false, ... }` includes "Edit link…" and "Remove link" (both with `enabled` unset, i.e. the `MenuItemConfig` default `true`), and no "Insert link…".
5. Same two cases for `kind: 'table-cell'`.
6. New exact item layouts (both text and table-cell menus have 14/15 and 15/16 total items respectively, per `linkUrl`) — see the tables below.
7. `toggleLink('https://x')` with a collapsed caret inside "hello" in `'hello world'` wraps only the enclosing word: `getValue()` contains `[hello](https://x) world`, not `[hello world](https://x)`.
8. `toggleLink('https://new')` with the caret collapsed inside an existing `[text](https://old)` updates the URL in place: `getValue()` contains `[text](https://new)` and does not contain `https://old`, and there is exactly one link in the document (no double-wrap).
9. `removeLink()` with the caret collapsed inside `[text](https://x)` leaves plain `text` in the document, with no `[`/`](` remaining.
10. `removeLink()` with only *part* of the link's text selected (e.g. `[hello world](https://x)`, "hello" selected) still removes the **whole** link, leaving plain `hello world` — the case that distinguishes `removeLink()` from bare `toggleLink(null)`.
11. `removeLink()` no-throws and leaves the value unchanged when the caret is not inside a link.
12. Round-trip: a link whose URL was changed in place via `toggleLink` (case 8) still round-trips through a fresh `MarkdownEditor.setValue(editor.getValue())` — extends the "dialect parity guard" `describe` block ([markdown-editor.test.ts:554-577](packages/lib/tests/component/markdown-editor.test.ts#L554-L577)).
13. `promptAndApplyLink`'s flow, via `vi.spyOn(Dialog, 'show')` (established precedent: [DialogSeverity.test.ts:67](packages/lib/tests/overlay/DialogSeverity.test.ts#L67)) mocked to inspect/mutate the `contentComponent` it's given:
    - Mock resolves `'confirm'` after calling `(config.contentComponent as TextField).setValue('https://new.example.com')` → the built "Insert link…"/"Edit link…" item's `action()` results in `toggleLink` being called with that URL (assert via `getValue()`).
    - Mock resolves `'cancel'` → no change to the document.
    - Mock resolves `'confirm'` with the field left at `''` (or whitespace) → no change.
    - For Edit specifically: mock resolves `'confirm'` with the field unchanged from its pre-filled default → no change (verifies the "if changed" guard).

**Manual-verify only** (needs a real DOM, a mounted Lexical view, and real `Dialog` focus/modal behavior, none of which the recording-sink harness provides — matching this file's own header comment, [markdown-editor.test.ts:38-43](packages/lib/tests/component/markdown-editor.test.ts#L38-L43)):

- Right-clicking on a real link in the live WYSIWYG surface shows "Edit link…"/"Remove link"; right-clicking on plain text/a selected word shows "Insert link…".
- The `Dialog` opens with the `TextField` focused and pre-filled correctly (empty for Insert, the current URL for Edit), Enter confirms, Escape/Cancel dismiss without changing the document.
- The document's selection survives the `Dialog`'s open-then-close focus steal, so `toggleLink`/`removeLink` still act on the right-clicked link/word after the dialog resolves — this plan relies on Lexical's own last-known-selection persistence across a focus change, the same assumption the class's existing "wire the command API to your own `Button`s" contract already depends on, so no new mechanism is added.
- The edited/inserted link renders with the theme's link styling and a correct `href` (Lexical's own `sanitizeUrl`).

New/updated exact item layouts (indices 0-based; supersedes the current 12/13-item tests):

| Index | Text context, `linkUrl: null` | Text context, `linkUrl: '…'` |
| --- | --- | --- |
| 0-2 | Cut, Copy, Paste | Cut, Copy, Paste |
| 3 | (separator) | (separator) |
| 4-7 | Bold, Italic, Strikethrough, Inline code | Bold, Italic, Strikethrough, Inline code |
| 8 | (separator) | (separator) |
| 9 | Insert link… | Edit link… |
| 10 | (separator) | Remove link |
| 11 | Block style | (separator) |
| 12 | (separator) | Block style |
| 13 | Clear formatting | (separator) |
| 14 | — | Clear formatting |
| **length** | **14** | **15** |

| Index | Table-cell context, `linkUrl: null` | Table-cell context, `linkUrl: '…'` |
| --- | --- | --- |
| 0-2 | Cut, Copy, Paste | Cut, Copy, Paste |
| 3 | (separator) | (separator) |
| 4-7 | Bold, Italic, Strikethrough, Inline code | Bold, Italic, Strikethrough, Inline code |
| 8 | (separator) | (separator) |
| 9 | Insert link… | Edit link… |
| 10 | (separator) | Remove link |
| 11 | Clear formatting | (separator) |
| 12 | (separator) | Clear formatting |
| 13 | Insert (submenu) | (separator) |
| 14 | Delete (submenu) | Insert (submenu) |
| 15 | — | Delete (submenu) |
| **length** | **15** | **16** |

---

## Verification

- `npx vitest run packages/lib/tests/component/markdown-editor.test.ts` — all existing and new cases green, including the updated index/length assertions.
- Project typecheck (e.g. `npm run typecheck` or the repo's equivalent) — confirms `linkUrl?: string | null` doesn't break any existing `ContextMenuTarget` literal, and that `LinkNode`/`$isLinkNode` import correctly.
- `npm run docs:api` — zero warnings (no new public JSDoc links an excluded symbol; `$findEnclosingLinkNode`, `promptForLinkUrl`, `promptAndApplyLink`, `buildLinkMenuItems` are all private/module-internal, so nothing outside this file's own JSDoc should name them via `{@link}`).
- Manual smoke test in the running app (e.g. the docs site's `MarkdownEditor` demo, or `MiscPanel`) per the Manual-verify list above.

---

## Documentation Impact

- `packages/lib/docs/components/MarkdownEditor.md`:
  - "Formatting" section ([:67](packages/lib/docs/components/MarkdownEditor.md#L67)): extend the context-menu description to mention that a word/selection or table cell also offers Insert/Edit/Remove link.
  - "Command API" table ([:69-84](packages/lib/docs/components/MarkdownEditor.md#L69-L84)): reword the `toggleLink(url)` row to mention the collapsed-caret word expansion and the update-in-place-on-an-existing-link behavior; add a `removeLink()` row directly after it.
- `packages/lib/docs/reference/changelog/next.md`: one bullet under "## Added" → "### Components", alongside the existing "`MarkdownEditor` gains `cut()` / `copy()` / `paste()`…" bullet, describing Insert/Edit/Remove Link, the enhanced `toggleLink`, and the new `removeLink()`.
- No barrel/export surface changes — `removeLink` is a method on the already-exported `MarkdownEditor`, no new top-level export.

---

## Potential Challenges

- **Overlap with `plans/markdown-editor-insert-line-around-block.md`** (already drafted, not yet implemented as of this writing). That plan also touches: `ContextMenuTarget`'s `"text"` member (adding its own optional `hasEnclosingBlock` field), `$classifyContextMenuTarget`'s `"text"` return ([MarkdownEditor.ts:397](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L397)), `buildTextContextMenuItems`, the same two classify-output `toEqual` assertions this plan updates (step 11's first two line ranges), the "all commands no-throw" chain, the class-level command-list doc comment, and `MarkdownEditor.md`'s Command API table/context-menu description. The two plans do not conflict *semantically* — different fields, different menu items, `buildTextContextMenuItems` gains a *spread* here versus a *conditional push* there, in different parts of the array — but a naive concurrent implementation will hit textual merge conflicts in all of the above. Mitigation: implement sequentially (`touches-shared` above flags this), and whichever lands second re-reads the file's actual current state rather than this plan's line numbers, which will have shifted.
- **`Dialog` focus-steal across the async prompt gap.** `promptAndApplyLink` awaits a modal `Dialog`, unlike every synchronous menu action (Bold, Cut, Copy) already in this menu. This is the same shape of gap `paste()` already has (an awaited clipboard read) — mitigated the same way: Lexical retains its own last-known editor-state selection independent of DOM focus, which is what every "wire to your own external Button" use of the command API already relies on. No new mechanism; flagged as manual-verify since the harness cannot exercise real focus changes.

---

## Critical Files

- [MarkdownEditor.ts:226-398](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L226-L398) — `ContextMenuTarget`, `$computeWordExpansion`, `$selectEnclosingWordIfCollapsed`, `$classifyContextMenuTarget` — the read-only-classification/lazy-expansion precedent this plan follows exactly.
- [MarkdownEditor.ts:1417-1637](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1417-L1637) — `handleWysiwygContextMenu`, `pasteAtContextMenuSelection`, and the four `build*ContextMenuItems`/`build*MenuItems` helpers — the precedent for a private-async-helper-wrapping-a-public-command menu action, and for shared item-builder helpers.
- [Table.ts:1865-1904](packages/lib/src/typescript/lib/component/table/Table.ts#L1865-L1904) — `showColumnDialog`, the real (non-doc-sample) precedent for `Dialog.show({ contentComponent, buttons })`.
- [DialogSeverity.test.ts:63-81](packages/lib/tests/overlay/DialogSeverity.test.ts#L63-L81) — the `vi.spyOn(Dialog, 'show')` mocking precedent this plan's new tests use.
- `node_modules/@lexical/link/src/LexicalLinkNode.ts:731-921` — `$toggleLink`'s actual update-in-place / collapsed-removal / partial-split behavior, traced in Architecture Decisions.
- `packages/lib/docs/components/Dialog.md` — the "Custom content" and "Initial focus" sections, for the prompt pattern this plan builds on.

---

## Non-Goals

- A fully collapsed caret with no adjacent word does not get a two-field (link-text + URL) insert prompt — see Architecture Decisions.
- No keyboard shortcut for Insert/Edit/Remove Link (none of this menu's other non-formatting commands have one either).
- No URL validation beyond trim-and-treat-empty-as-cancelled — matches `toggleLink`'s existing zero-validation contract; malformed/disallowed-scheme URLs are already handled at render time by `LinkNode.sanitizeUrl`.
- No change to `markdownTransformers.ts`, `editorNodes.ts`, or the Lexical node registration — links already round-trip correctly.

---

## Notes

[^optional-field]: Typed optional (`linkUrl?: string | null`) rather than required, even though `$classifyContextMenuTarget` always computes and includes it, so the many existing hand-built `ContextMenuTarget` object literals used elsewhere in the test suite as menu-builder *inputs* (not as assertions on `$classifyContextMenuTarget`'s output) continue to typecheck without every one of them being touched. This mirrors `plans/markdown-editor-insert-line-around-block.md`'s identical choice for its own new `hasEnclosingBlock` field on the same type, drafted independently but landing on the same pattern for the same reason.

[^toggle-link-trace]: Tracing `$toggleLink` (`node_modules/@lexical/link/src/LexicalLinkNode.ts:731-921`): for a **collapsed** selection, `selection.extract()` returns the single unsplit anchor text node (`LexicalSelection.ts:1432-1443`, the `selectedNodesLength === 1` branch skips splitting when `isCollapsed()`); `$toggleLink`'s own `nodes.length === 1` fast path (`:865-873`) then finds that node's nearest `LinkNode` ancestor via `$findMatchingParent` and, if found, calls `updateLinkNode(linkNode)` — setting the URL on the *existing* node, not creating a new one. For **removal** for a collapsed selection, a separate earlier branch (`:800-819`) splices the whole link's children into its parent and removes it — again the *whole* link, not just up to the caret. Only the **range**-selection removal path (`:824-845`, via `$splitLinkAtSelection`) is scoped to the extracted (selected) sub-range, which is what `removeLink()` deliberately routes around by collapsing first.

[^bare-caret-rejected]: A two-field prompt (link text + URL) was considered for a fully bare caret, since `LinkNode.canBeEmpty()` is `false` so there is no way to "wrap nothing." Rejected: `insertTable(rows, columns)` — this file's other content-creating insert command — takes structural parameters (row/column counts), not a text-content prompt, so there is no existing precedent in this menu for a multi-field text-entry dialog; adding one is a bigger UI surface than the feature asked for, and gating on `hasSelectedText` reuses a field and a disabled-item convention (Cut/Copy) that already exists.

[^read-only-precedent]: The most recent commit on this file (`890399f2`, "Add Cut/Copy/Paste…") fixed exactly this class of bug: `$classifyContextMenuTarget` used to call `$selectEnclosingWordIfCollapsed()` eagerly, at menu-build time, visibly highlighting a word for as long as the menu stayed open even though most actions never used that expansion. The fix made classification a pure read via `$computeWordExpansion()` and pushed every actual expansion into the specific action that needs it, right when that action is invoked. This plan's `linkUrl` read and `toggleLink`'s expansion call both follow that same rule, so a right-click still never mutates the visible selection on its own.
