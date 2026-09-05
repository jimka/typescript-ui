---
depends-on:
  - clipboard-context-menu-foundation
touches-shared:
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/docs/concepts/dom-seams.md
  - packages/lib/docs/reference/changelog/next.md
---

# Selectable-Text Context-Menu Copy — Implementation Plan

## Overview

`Body.init` suppresses the browser's own right-click menu page-wide ([native-context-menu-suppression.md](implemented/native-context-menu-suppression.md)). Read-only text the reader is meant to be able to select therefore lost its one way to copy with the mouse. This plan gives such text a **Copy-only** right-click menu — no Cut, no Paste, because none of it is editable.

Two components carry the mechanism. [`SelectableText`](../packages/lib/src/typescript/lib/component/input/SelectableText.ts) gains an opt-in `copyMenu` option and the mechanism behind it; exactly three call sites opt in — the default message body of [`Dialog`](../packages/lib/src/typescript/lib/overlay/Dialog.ts) ([Dialog.ts:741](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L741)), a live toast's message in [`Notification`](../packages/lib/src/typescript/lib/overlay/Notification.ts) ([Notification.ts:208](../packages/lib/src/typescript/lib/overlay/Notification.ts#L208)), and the full-message content of `Notification.showDetail` ([Notification.ts:525](../packages/lib/src/typescript/lib/overlay/Notification.ts#L525)). The read-only [`Markdown`](../packages/lib/src/typescript/lib/component/display/Markdown.ts) viewer gets the same menu through its own wiring, because it is not a `SelectableText` — it is a `Component` whose class defaults set `userSelect: "text"` on its root ([Markdown.ts:475](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L475)). [`MarkdownViewer`](../packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts) embeds a `Markdown` as a registered child ([MarkdownViewer.ts:172](../packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L172)) and inherits the menu with no code of its own.

Supporting both is one new DOM-seam read, `DOMSource.getDocumentSelectionText()`, and one new shared helper, `buildSelectionCopyMenuItems(element)`, which resolves the page's live selection against a single component's own element before offering to copy it.

**Branch base.** This plan's dependency, [`clipboard-context-menu-foundation.md`](implemented/clipboard-context-menu-foundation.md), is implemented on the unmerged branch `feature/clipboard-context-menu-foundation`, not on `master`. Create this plan's worktree from that branch's tip, not from `master`: `git worktree add .worktrees/selectable-text-context-menu-copy -b feature/selectable-text-context-menu-copy feature/clipboard-context-menu-foundation`. Branching from `master` instead leaves `buildClipboardMenuItems` and `docs/reference/changelog/next.md` missing, and every step below fails.

---

## Architecture Decisions

### The menu is opt-in on `SelectableText`, off by default

`SelectableTextOptions` gains `copyMenu?: boolean`, defaulting to `false`. The mechanism is inert until a call site asks for it. Only three call sites do, all outside the table subsystem.[^opt-in]

### The `contextmenu` listener is registered unconditionally; the handler self-guards

`SelectableText`'s constructor always registers `Event.addListener(this, "contextmenu", this.handleContextMenu)`, and `handleContextMenu` returns immediately when `hasCopyMenu()` is `false`. This mirrors [`Link.ts:162-167`](../packages/lib/src/typescript/lib/component/input/Link.ts#L162), which registers its `keydown` listener "once for the component's whole life, regardless of `interactive`" and self-guards in the handler.[^wire-once]

A guarded-off handler returns nothing, so the dispatcher leaves the event alone and its ancestor walk continues. That fall-through is what keeps every table surface working untouched:

| Right-clicked element | `copyMenu` | Handler returns | What ends up handling the event |
|---|---|---|---|
| `Dialog`'s message `SelectableText` | `true` | `{ stop: true, prevent: true }` | this plan's Copy menu |
| A `String`/`Number`/`Date` cell renderer's `SelectableText` | `false` (never set) | nothing | `Body`'s subtree listener ([Body.ts:1043](../packages/lib/src/typescript/lib/component/table/Body.ts#L1043)) — the table's own cell menu |
| `HeaderCellText` (a `SelectableText` subclass) | `false` (never set) | nothing | `HeaderCell`'s subtree listener ([Header.ts:248](../packages/lib/src/typescript/lib/component/table/cell/Header.ts#L248)) — the column menu |
| `ParentHeaderCellText` (a `SelectableText` subclass) | `false` (never set) | nothing | `ParentHeaderCell`'s subtree listener ([ParentHeader.ts:305](../packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L305)) |

### `SelectableText` uses an exact-target listener; `Markdown` uses a subtree listener

`SelectableText` renders one `<span>` with no element children, so a right-click on it always targets that span — `Event.addListener` is enough, matching [`CollapseButton.ts:178`](../packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L178). `Markdown` builds a whole subtree of raw prose elements under its root, so a right-click targets a `<p>`, `<code>`, or `<li>` and never the root — it needs `Event.addSubtreeListener`.[^listener-shape]

### The selected text is captured when the menu opens, not when Copy is clicked

`buildSelectionCopyMenuItems` reads the selection once and closes the Copy row's action over the resulting string. Clicking a menu row moves the browser's own selection, so re-reading it at click time would copy the wrong thing — or nothing.[^capture-early]

### Containment is decided in the component layer; the seam only flattens the selection to text

The new seam read `DOMSource.getDocumentSelectionText(): string` returns `window.getSelection()?.toString() ?? ""` and nothing else. Deciding *whether* that selection belongs to a given element stays in `buildSelectionCopyMenuItems`, which requires **both** endpoints of the existing `DOMSource.getDocumentSelection()` result ([DOM.ts:1142](../packages/lib/src/typescript/lib/core/DOM.ts#L1142)) to sit inside the element, tested with the existing `DOMSource.contains` ([DOM.ts:1210](../packages/lib/src/typescript/lib/core/DOM.ts#L1210)).[^seam-split]

A DOM range runs contiguously in document order, so both endpoints being inside one subtree means the whole range is:

| Selection start | Selection end | `buildSelectionCopyMenuItems(element)` |
|---|---|---|
| inside `element` | inside `element` | Copy enabled, carrying the selected text |
| inside `element` | outside `element` | Copy dimmed |
| outside `element` | inside `element` | Copy dimmed |
| outside `element` | outside `element` | Copy dimmed |
| collapsed caret (`getDocumentSelection` returns `null`) | — | Copy dimmed |

### Copy is always offered and dims when nothing is selected

Every surface here is read-only, so there is no enabled / disabled / read-only state to gate on. The `ClipboardMenuConfig` always carries a `copy` handler and never a `cut` or `paste` one, so the menu is a single row; `hasSelectedText` is the only thing that varies, dimming Copy when the selection is empty — the same convention the rest of this batch uses.

### The `Menu` instance is created on first right-click, not in the constructor

Both `SelectableText` and `Markdown` hold `private _contextMenu: Menu | null = null` and create the `Menu` inside the handler. A table body pools hundreds of `SelectableText` instances, and none of them ever opens this menu.[^lazy-menu]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/input/SelectableText.ts

export interface SelectableTextOptions extends TextOptions {
    /**
     * Whether a right-click offers a Copy row for text selected inside this
     * component. Defaults to `false`.
     */
    copyMenu?: boolean;
}

/** Turns the right-click Copy menu on or off. */
setCopyMenu(enabled: boolean): this;

/** Whether the right-click Copy menu is on. */
hasCopyMenu(): boolean;
```

The backing store for `copyMenu` is the options bag itself (`this._options.copyMenu`), per ARCHITECTURE.md's default setter shape — the setter stores the caller's value unchanged, so no private field is involved and no `declare` is needed.

```typescript
// packages/lib/src/typescript/lib/core/DOM.ts — added to the DOMSource interface,
// implemented by ProductionDOMSource (and by ModelledDOMSource in the test harness).

/**
 * The page's current selection flattened to plain text — the browser's own
 * rendering of a selection that may span many nodes. `""` when nothing is
 * selected.
 */
getDocumentSelectionText(): string;
```

The return type is `string`, so `core/index.ts` needs no new entry.[^no-barrel-entry]

```typescript
// packages/lib/src/typescript/lib/component/shared/buildSelectionCopyMenuItems.ts

export function buildSelectionCopyMenuItems(element: Handle): MenuItemConfig[];
```

`Markdown` gains no new public API: its Copy menu is always on and carries no option.[^markdown-no-option]

---

## Internal Structure

The new shared module in full, minus JSDoc:

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { buildClipboardMenuItems } from "~/component/shared/buildClipboardMenuItems.js";

function selectedTextWithin(element: Handle): string {
    const selection = DOM.source.getDocumentSelection();

    if (selection === null
        || !DOM.source.contains(element, selection.startContainer)
        || !DOM.source.contains(element, selection.endContainer)) {
        return "";
    }

    return DOM.source.getDocumentSelectionText();
}

export function buildSelectionCopyMenuItems(element: Handle): MenuItemConfig[] {
    const text = selectedTextWithin(element);

    return buildClipboardMenuItems({
        hasSelectedText: text !== "",
        copy:            () => DOM.sink.writeClipboardText(text),
    });
}
```

`ProductionDOMSource.getDocumentSelectionText`, placed directly after that class's `getDocumentSelection` ([DOM.ts:2338](../packages/lib/src/typescript/lib/core/DOM.ts#L2338)):

```typescript
/** @inheritDoc */
getDocumentSelectionText(): string {
    return window.getSelection()?.toString() ?? "";
}
```

`ModelledDOMSource.getDocumentSelectionText`, placed directly after that class's `getDocumentSelection` ([TestDOM.ts:1129](../packages/lib/tests/dom/TestDOM.ts#L1129)):

```typescript
/** No live Selection offline; always reports no selected text. */
getDocumentSelectionText(): string {
    return "";
}
```

`SelectableText`'s additions. The three new imports, added to its existing import block ([SelectableText.ts:3-5](../packages/lib/src/typescript/lib/component/input/SelectableText.ts#L3)) — `Markdown` needs the same three:

```typescript
import { Event } from "~/core/Event.js";
import { Menu } from "~/overlay/Menu.js";
import { buildSelectionCopyMenuItems } from "~/component/shared/buildSelectionCopyMenuItems.js";
```

The field and the constructor line:

```typescript
// Self-wired Copy replacement for the browser's own right-click menu,
// suppressed page-wide by Body.init (native-context-menu-suppression.md).
// Created on first right-click, not here: a table body pools hundreds of
// SelectableText instances that never open it. Never a registered child —
// disposed explicitly in destructor().
private _contextMenu: Menu | null = null;

constructor(
    text?: String,
    options?: SelectableTextOptions,
    subclassDefaults?: Partial<SelectableTextOptions>,
) {
    super(text, options, { ..._defaultSelectableTextOptions, ...(subclassDefaults ?? {}) });

    // Wired once for the component's whole life, regardless of `copyMenu`:
    // handleContextMenu self-guards, so the flag needs no listener churn.
    // Mirrors Link's keydown registration.
    Event.addListener(this, "contextmenu", this.handleContextMenu);
}
```

The setter, getter, and `applyOptions` dispatch:

```typescript
setCopyMenu(enabled: boolean): this {
    this._options.copyMenu = enabled;

    return this;
}

hasCopyMenu(): boolean {
    return this._options.copyMenu ?? this._defaultOptions.copyMenu ?? false;
}

protected applyOptions(options: SelectableTextOptions): this {
    super.applyOptions(options);

    this.setCopyMenu(options.copyMenu ?? this.hasCopyMenu());

    return this;
}
```

The handler and the destructor:

```typescript
private handleContextMenu(event: MouseEvent): Event.ListenerResult {
    if (!this.hasCopyMenu()) {
        return;
    }

    const element = this.getElement();

    if (element) {
        this._contextMenu ??= new Menu();
        this._contextMenu.show(event.clientX, event.clientY, buildSelectionCopyMenuItems(element));
    }

    return { stop: true, prevent: true };
}

protected destructor(): void {
    this._contextMenu?.dispose();
    this._contextMenu = null;

    super.destructor();
}
```

`Markdown`'s additions are the same field, the same handler minus its `hasCopyMenu()` guard, a subtree registration at the end of the constructor ([Markdown.ts:619](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L619)):

```typescript
Event.addSubtreeListener(this, "contextmenu", this.handleContextMenu);
```

and two lines prepended to its existing `destructor()` ([Markdown.ts:912](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L912)):

```typescript
this._contextMenu?.dispose();
this._contextMenu = null;
```

The three opt-in call sites each gain one option:

```typescript
// Dialog.ts:741
const messageText = new SelectableText(config.message ?? '', { copyMenu: true });

// Notification.ts:208
this._messageText = new SelectableText(message, { copyMenu: true });

// Notification.ts:525
const content = new SelectableText(message, { copyMenu: true });
```

---

## Ordered Implementation Steps

1. **Create the worktree from the dependency's branch.** `git worktree add .worktrees/selectable-text-context-menu-copy -b feature/selectable-text-context-menu-copy feature/clipboard-context-menu-foundation`, then work inside it.
   *Check:* `ls packages/lib/src/typescript/lib/component/shared/buildClipboardMenuItems.ts` and `ls packages/lib/docs/reference/changelog/next.md` both succeed. If either is missing, the branch base is wrong — stop.

2. **Add the seam read.** In [`packages/lib/src/typescript/lib/core/DOM.ts`](../packages/lib/src/typescript/lib/core/DOM.ts): declare `getDocumentSelectionText(): string;` in the `DOMSource` interface directly after `getDocumentSelection` ([:1142](../packages/lib/src/typescript/lib/core/DOM.ts#L1142)), with JSDoc stating it returns the browser's own flattening of a possibly multi-node selection, and `""` when nothing is selected. Implement it in `ProductionDOMSource` directly after that class's `getDocumentSelection` ([:2338](../packages/lib/src/typescript/lib/core/DOM.ts#L2338)), from `## Internal Structure`.
   *Check:* `grep -n "getDocumentSelectionText" packages/lib/src/typescript/lib/core/DOM.ts` — exactly two matches.

3. **Implement the seam read offline.** In [`packages/lib/tests/dom/TestDOM.ts`](../packages/lib/tests/dom/TestDOM.ts), add `ModelledDOMSource.getDocumentSelectionText` directly after that class's `getDocumentSelection` ([:1129](../packages/lib/tests/dom/TestDOM.ts#L1129)), from `## Internal Structure`.
   *Check:* `npm run typecheck` and `npm -w packages/lib run typecheck:test` both pass. `grep -rn "implements DOMSource" packages/lib/src packages/lib/tests` returns exactly two lines — the only two implementations that had to be updated.

4. **Write the shared-helper tests (red).** Create `packages/lib/tests/component/shared/buildSelectionCopyMenuItems.test.ts`, covering behaviours 1-7. Unlike its neighbour [`buildClipboardMenuItems.test.ts`](../packages/lib/tests/component/shared/buildClipboardMenuItems.test.ts) this one needs a DOM, so follow [`tests/dom/seam-predicates.test.ts`](../packages/lib/tests/dom/seam-predicates.test.ts)'s shape: `installTestDOM(CONFIG)` per case and `afterEach(() => DOM.reset())`. Mint handles with `DOM.sink.createElement('div')` and model containment with `DOM.sink.appendChild(parent, child)` — `ModelledDOMSource.contains` ([TestDOM.ts:1173](../packages/lib/tests/dom/TestDOM.ts#L1173)) climbs exactly those recorded parents. Seed a selection with `vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({ … })` and `vi.spyOn(DOM.source, 'getDocumentSelectionText').mockReturnValue('…')`, the idiom [`Body.test.ts:1156`](../packages/lib/tests/component/table/Body.test.ts#L1156) already uses. It fails to compile until Step 5.

5. **Create the shared helper.** Add `packages/lib/src/typescript/lib/component/shared/buildSelectionCopyMenuItems.ts` from `## Internal Structure`. Give the exported function a JSDoc that states the both-endpoints containment rule and the capture-at-build-time behaviour, and closes with `@internal Shared by every read-only selectable surface offering Copy in its right-click menu; not barrel-exported.` — the same closing tag line its three neighbours in that directory carry.
   *Check:* Step 4's tests go green.

6. **Write the `SelectableText` tests (red).** Create `packages/lib/tests/component/input/SelectableText.test.ts`, covering behaviours 8-13. Drive the real listener with `Event.fireEvent(text, makeEvent(el, 'contextmenu', { clientX, clientY }))` ([`TestDOM.ts:1499`](../packages/lib/tests/dom/TestDOM.ts#L1499)) and assert the resulting menu with `vi.spyOn(Menu.prototype, 'show')`, following [`text-input-context-menu-clipboard.md`](text-input-context-menu-clipboard.md)'s Step 2. For behaviour 9's fall-through, add the `SelectableText` to a parent `Panel` carrying `Event.addSubtreeListener(panel, "contextmenu", …)` and assert that listener ran — render the pair first, so the sink has recorded the parent link `ModelledDOMSource.getParentElement` ([TestDOM.ts:1214](../packages/lib/tests/dom/TestDOM.ts#L1214)) climbs during the subtree walk.

7. **Implement `SelectableText`.** In [`packages/lib/src/typescript/lib/component/input/SelectableText.ts`](../packages/lib/src/typescript/lib/component/input/SelectableText.ts): add the `Event`, `Menu`, and `buildSelectionCopyMenuItems` imports; add `copyMenu` to `SelectableTextOptions` ([:12](../packages/lib/src/typescript/lib/component/input/SelectableText.ts#L12)); add the `_contextMenu` field, the constructor registration, `applyOptions`, `setCopyMenu`, `hasCopyMenu`, `handleContextMenu`, and `destructor` — all from `## Internal Structure`. Extend the class doc comment ([:24-33](../packages/lib/src/typescript/lib/component/input/SelectableText.ts#L24)) with a sentence describing the opt-in Copy menu in prose (no `{@link}` to the private handler or the internal helper, per CODE_CONVENTIONS.md).
   *Check:* Step 6's tests go green.

8. **Opt the three call sites in.** Add `{ copyMenu: true }` at [Dialog.ts:741](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L741), [Notification.ts:208](../packages/lib/src/typescript/lib/overlay/Notification.ts#L208), and [Notification.ts:525](../packages/lib/src/typescript/lib/overlay/Notification.ts#L525), from `## Internal Structure`. Extend [`tests/overlay/Dialog.test.ts`](../packages/lib/tests/overlay/Dialog.test.ts) and [`tests/overlay/Notification.test.ts`](../packages/lib/tests/overlay/Notification.test.ts) with behaviours 16-18; `Notification.test.ts:74` already reaches the toast's `_messageText` white-box, and `Dialog.getContentComponent()` ([Dialog.ts:1333](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1333)) returns the content `Panel` whose first child is the message text.
   *Check:* `grep -rn "copyMenu" packages/lib/src/typescript/lib/component/table/` — **zero matches**. This is the check that proves no table surface opts in.

9. **Implement `Markdown`.** In [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](../packages/lib/src/typescript/lib/component/display/Markdown.ts): add the `Event`, `Menu`, and `buildSelectionCopyMenuItems` imports; add the `_contextMenu` field; add the subtree registration at the end of the constructor ([:619](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L619)); add `handleContextMenu` (no `hasCopyMenu()` guard); prepend the two dispose lines to the existing `destructor()` ([:912](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L912)). Extend [`tests/component/display/Markdown.test.ts`](../packages/lib/tests/component/display/Markdown.test.ts) with behaviours 14-15.
   *Check:* those two tests go green.

10. **Table regression checkpoint.** `cd packages/lib && npx vitest run tests/component/table/` — green with **no test edits**, which is what proves the fall-through kept `Body`, `HeaderCell`, and `ParentHeaderCell` intact (behaviour 19).

11. **Full check.** `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`, `npm run lint`, `npm run docs:api` (zero warnings).

12. **Docs.** Apply every edit in `## Documentation Impact`, per the `document` skill.

13. **Manual smoke test.** Behaviours 20-24, in the running demo app.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Create | `packages/lib/src/typescript/lib/component/shared/buildSelectionCopyMenuItems.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/SelectableText.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/component/shared/buildSelectionCopyMenuItems.test.ts` |
| Create | `packages/lib/tests/component/input/SelectableText.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/tests/overlay/Notification.test.ts` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/components/Text.md` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/Dialog.md` |
| Modify | `packages/lib/docs/components/Notification.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No file under `packages/lib/src/typescript/lib/component/table/` is touched, and no test under `packages/lib/tests/component/table/` is edited — Step 10 requires them all to pass unchanged. See `## Non-Goals`.

---

## Expected Behaviour

**Unit-testable — the shared helper** (`tests/component/shared/buildSelectionCopyMenuItems.test.ts`, under `installTestDOM`):

1. With no spies at all — the modelled source reports no selection and no selected text — `buildSelectionCopyMenuItems(h)` returns exactly one row, `text: "Copy"`, `enabled: false`.
2. With `getDocumentSelection` spied to a range whose `startContainer` and `endContainer` are both descendants of `h`, and `getDocumentSelectionText` spied to `"hello"`, the single row carries `enabled: true`.
3. In case 2, invoking that row's `action` records exactly one `writeClipboardText` write carrying `"hello"`.
4. With `startContainer` inside `h` and `endContainer` outside it, the row carries `enabled: false`.
5. With both containers outside `h`, the row carries `enabled: false`.
6. The text is captured when the rows are built: after building in case 2's setup, changing `getDocumentSelectionText`'s mock to `"other"` and only then invoking the action still writes `"hello"`.
7. The returned array never contains a `"Cut"` or a `"Paste"` row, for any of cases 1-5.

**Unit-testable — `SelectableText`** (`tests/component/input/SelectableText.test.ts`):

8. `new SelectableText("x").hasCopyMenu()` is `false`; `new SelectableText("x", { copyMenu: true }).hasCopyMenu()` is `true`.
9. With `copyMenu` unset, firing a `contextmenu` event on the rendered element does **not** call `Menu.prototype.show`, and a `contextmenu` subtree listener registered on the parent `Panel` **does** fire.
10. With `copyMenu: true`, the same event calls `Menu.prototype.show` exactly once, with the event's `clientX`/`clientY` and a one-row item list whose `text` is `"Copy"`; the parent `Panel`'s subtree listener does **not** fire.
11. With `copyMenu: true` and a contained selection spied in, the row carries `enabled: true`; with no selection spied, `enabled: false`.
12. `setCopyMenu(true)` on a component constructed without the option turns the menu on (behaviour 10 then holds); a following `setCopyMenu(false)` turns it back off (behaviour 9 then holds).
13. Disposing a `SelectableText` that has opened its menu calls `dispose` on that `Menu` (assert via `vi.spyOn(Menu.prototype, 'dispose')`).

**Unit-testable — `Markdown`** (`tests/component/display/Markdown.test.ts`):

14. Firing a `contextmenu` event whose target is a rendered prose element inside a `Markdown`'s subtree — `Event.fireEvent(markdown, makeEvent(childHandle, 'contextmenu', { clientX, clientY }))` — calls `Menu.prototype.show` exactly once with a one-row `"Copy"` item list.
15. Disposing a `Markdown` that has opened its menu calls `dispose` on that `Menu`.

**Unit-testable — the opt-in call sites:**

16. A `Dialog` built from a plain `message` config has a content `Panel` (`getContentComponent()`) whose first child reports `hasCopyMenu() === true`.
17. A live toast's `_messageText` reports `hasCopyMenu() === true`.
18. The `SelectableText` `Notification.showDetail` puts in its dialog reports `hasCopyMenu() === true`.

**Unit-testable — regression** (existing files, no edits):

19. Every test under `packages/lib/tests/component/table/` passes unchanged — in particular [`CellTextSelection.test.ts`](../packages/lib/tests/component/table/CellTextSelection.test.ts), [`cell/Header.test.ts`](../packages/lib/tests/component/table/cell/Header.test.ts), and [`Body.test.ts`](../packages/lib/tests/component/table/Body.test.ts).

**Manual** (`npm run dev`, app on `localhost:8015`):

20. In a dialog with a plain message, selecting part of the message and right-clicking it opens a one-row Copy menu; Copy puts exactly the selected substring on the clipboard. Right-clicking with nothing selected opens the same menu with Copy dimmed.
21. In the **Misc** panel, raising a notification and right-clicking its toast message behaves the same way; double-clicking the toast opens the detail dialog, whose message behaves the same way again.
22. In the **Markdown** panel, selecting prose across two paragraphs and right-clicking it copies the whole selection. Right-clicking inside a syntax-highlighted fenced code block opens the same Copy menu.
23. Right-clicking a table data cell still opens the table's own cell menu, and right-clicking a column header still opens the column menu — both unchanged, including after selecting text inside a cell.
24. Selecting text in one notification toast, then right-clicking a *different* toast, shows Copy dimmed — the other toast's selection is not offered.

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` — clean.
- `cd packages/lib && npx vitest run tests/component/shared/buildSelectionCopyMenuItems.test.ts tests/component/input/SelectableText.test.ts tests/component/display/Markdown.test.ts tests/overlay/Dialog.test.ts tests/overlay/Notification.test.ts` — all green.
- `cd packages/lib && npx vitest run tests/component/table/` — green, unedited (behaviour 19).
- `npm test` — the whole suite; no regression.
- `npm run lint` — clean. `window.getSelection` is read only inside `ProductionDOMSource`, so `local/no-raw-dom` stays at its empty baseline. Confirm with `grep -rn "getSelection()" packages/lib/src` — hits in `core/DOM.ts` only.
- `grep -rn "copyMenu" packages/lib/src/typescript/lib/component/table/` — zero matches.
- `grep -rn "buildSelectionCopyMenuItems" packages/lib/src` — hits only in `component/shared/buildSelectionCopyMenuItems.ts`, `component/input/SelectableText.ts`, and `component/display/Markdown.ts`.
- `grep -rn "getDocumentSelectionText" packages/lib/src packages/lib/tests` — in `packages/lib/src`, hits only in `core/DOM.ts` and `component/shared/buildSelectionCopyMenuItems.ts`; every other hit is in `tests/dom/TestDOM.ts` or one of the test files this plan creates or edits.
- `npm run docs:api` — zero warnings.
- `npm run build:docs` — clean VitePress build.
- Manual cases 20-24 above.

---

## Documentation Impact

- **[`packages/lib/docs/concepts/dom-seams.md:63`](../packages/lib/docs/concepts/dom-seams.md#L63)** — the globals list already names `getDocumentSelection`. Add `getDocumentSelectionText` beside it, and one sentence saying it returns the browser's own flattening of the current selection to plain text, for a caller that would otherwise have to walk the DOM to rebuild it from container/offset pairs.
- **[`packages/lib/docs/components/Text.md:5`](../packages/lib/docs/components/Text.md#L5)** — the sentence pointing at `SelectableText` already explains what it is for. Extend it to note that `SelectableText` can also offer a right-click Copy menu, via its `copyMenu` option.
- **[`packages/lib/docs/components/Markdown.md`](../packages/lib/docs/components/Markdown.md)** — add a short `## Selecting and copying` section between `## Construction` and `## Supported syntax (v1)`, stating that rendered prose is selectable and that a right-click offers Copy for the current selection, dimmed when nothing is selected.
- **[`packages/lib/docs/components/Dialog.md`](../packages/lib/docs/components/Dialog.md)** — add a sentence to `## One-shot prompt` noting the message body is selectable and right-click-copyable. Custom content (`## Custom content`) is not, unless the consumer's own components provide it.
- **[`packages/lib/docs/components/Notification.md`](../packages/lib/docs/components/Notification.md)** — add a `## Behavior` bullet noting a toast's message, and the detail dialog's full message, are both selectable and right-click-copyable.
- **[`packages/lib/docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)** — two entries. Under `## Added` → `### Components`: "`SelectableText` gains a `copyMenu` option (and `setCopyMenu()` / `hasCopyMenu()`) offering a right-click Copy menu for text selected inside it; `Dialog`'s message body, `Notification`'s toast and detail messages, and the `Markdown` viewer all offer it, restoring what `Body.init`'s native-context-menu suppression removed." Under `## Breaking changes` → `### Core`, beside the existing `getSelectionRange()` bullet: "**`DOMSource` gains one required member: `getDocumentSelectionText()`.** Only a consumer implementing its own `DOMSource` is affected."
- **`packages/lib/llms.txt` needs no change** — it is generated from `scripts/llms/manifest.data.mjs` and indexes capabilities and hard rules, neither of which this adds. Do not regenerate it.

---

## Potential Challenges

- **A `contextmenu` listener now exists on every `SelectableText`, including every pooled table cell's.** It is one entry in the dispatcher's per-type map and does nothing when `copyMenu` is off; the window-level `contextmenu` base listener is already installed by `Body.init` regardless. `Link` accepts the identical trade for its `keydown` listener.
- **`Markdown` embeds a live, read-only `CodeEditor` for fenced code blocks that name a known language.** Those editors are appended as raw DOM inside `Markdown`'s subtree, so a right-click inside one reaches `Markdown`'s subtree listener, which stops propagation. `Markdown`'s Copy menu therefore wins there, and copies the code the user selected — correct, since an embedded editor is read-only and Copy is all it could offer. [`code-editor-context-menu-clipboard.md`](code-editor-context-menu-clipboard.md) registers its own menu through CodeMirror's bubble-phase `domEventObservers`, which never runs once the framework's window-capture dispatch has stopped the event; a standalone `CodeEditor` outside `Markdown` is unaffected.
- **The offline harness cannot produce a real browser selection.** `ModelledDOMSource.getDocumentSelection` and `getDocumentSelectionText` both report "nothing selected" unconditionally, so every behaviour that needs a selection is driven by `vi.spyOn` on those two members. Behaviour 1 is the case that pins the un-spied default.
- **`Dialog` also accepts a `contentComponent`**, and this plan gives that path nothing. `Notification.showDetail` is a `contentComponent` caller and opts in explicitly at its own construction site; any other consumer-supplied content brings its own behaviour.
- **`Menu` is a `Position.FIXED` overlay and is never `addComponent`-ed**, so the base class's child recursion cannot reach it. Both `destructor()` overrides dispose it explicitly, the same shape `Table.destructor` uses for `_columnContextMenu`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/input/SelectableText.ts`](../packages/lib/src/typescript/lib/component/input/SelectableText.ts) — the file the mechanism goes into; 59 lines today, with no constructor body beyond `super()`.
- [`packages/lib/src/typescript/lib/component/input/Link.ts:162-167`](../packages/lib/src/typescript/lib/component/input/Link.ts#L162) — the wire-once-and-self-guard precedent, in a sibling `Text` subclass. Read its `keydown` registration comment before writing the constructor.
- [`packages/lib/src/typescript/lib/component/input/Text.ts:226-237`](../packages/lib/src/typescript/lib/component/input/Text.ts#L226) — the `destructor()` and `applyOptions()` this plan overrides one level below.
- [`plans/text-input-context-menu-clipboard.md`](text-input-context-menu-clipboard.md) — the closest structural precedent: one self-wired menu on a shared base, a lazy-versus-eager `Menu` field, `handleContextMenu`'s shape, and the `Event.fireEvent` + `vi.spyOn(Menu.prototype, 'show')` test idiom.
- [`plans/implemented/clipboard-context-menu-foundation.md`](implemented/clipboard-context-menu-foundation.md) and [`packages/lib/src/typescript/lib/component/shared/buildClipboardMenuItems.ts`](../packages/lib/src/typescript/lib/component/shared/buildClipboardMenuItems.ts) *(exists only on `feature/clipboard-context-menu-foundation`)* — the builder this plan calls, and the one-function-per-file convention the new shared module follows.
- [`packages/lib/src/typescript/lib/core/DOM.ts:1142,1210,1482-1497,2338,2411`](../packages/lib/src/typescript/lib/core/DOM.ts#L1142) — `getDocumentSelection`, `contains`, `DocumentSelectionRange`, and their production implementations.
- [`packages/lib/src/typescript/lib/core/Event.ts:248-345`](../packages/lib/src/typescript/lib/core/Event.ts#L248) — the dispatcher. Read it to see that exact-target listeners run before the subtree walk and that a stop disposition ends that walk before it starts; this is what the fall-through table in `## Architecture Decisions` rests on.
- [`packages/lib/src/typescript/lib/component/table/Body.ts:1043,1983-1996`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1043) — the table's own subtree `contextmenu` listener and `onCellContextMenu`, which the fall-through must leave reachable.
- [`packages/lib/src/typescript/lib/component/table/cell/Header.ts:248`](../packages/lib/src/typescript/lib/component/table/cell/Header.ts#L248) and [`cell/ParentHeader.ts:305`](../packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L305) — the two header subtree listeners, whose `SelectableText` subclasses set `userSelect: "none"` and must keep falling through.
- [`packages/lib/src/typescript/lib/overlay/Menu.ts:297`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L297) — `show(x, y, configs)`.
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts:53`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L53) — `MenuItemConfig`, for `text` / `action` / `enabled` semantics.
- [`packages/lib/tests/dom/TestDOM.ts:1129,1173`](../packages/lib/tests/dom/TestDOM.ts#L1129) — `ModelledDOMSource.getDocumentSelection` (the "no live Selection offline" precedent the new member copies) and `contains` (the modelled parent climb the helper's tests rely on).
- [`packages/lib/tests/component/table/Body.test.ts:1156`](../packages/lib/tests/component/table/Body.test.ts#L1156) — the existing `vi.spyOn(DOM.source, 'getDocumentSelection')` idiom the new tests reuse.
- [`plans/implemented/native-context-menu-suppression.md`](implemented/native-context-menu-suppression.md) — why this menu is needed at all.

---

## Non-Goals

- **No changes to `Table`, `TreeTable`, `Body`, `Row`, `Cell`, any cell renderer, or either header cell.** The six cell renderers that build a `SelectableText` (`String`, `Number`, `Date`, `DateTime`, `Time`, `Combo`) never set `copyMenu`, so their text falls through to the table's own cell menu exactly as it does today — and [`table-cell-context-menu-clipboard.md`](table-cell-context-menu-clipboard.md), a separate plan in this batch, is what gives table cells a menu, deliberately offering more than Copy. `HeaderCellText` and `ParentHeaderCellText` are `SelectableText` subclasses too, but both override `userSelect` back to `"none"`, so there is nothing in them to copy; they also fall through, keeping the column menus alive.
- **No new component becomes selectable.** This plan adds `SelectableText` nowhere and changes no component's `userSelect`. Text that is unselectable today — `StatusBar`'s message, tree-node labels, button and menu labels, table headers — stays unselectable and gets no menu.
- **`Link` is excluded.** `Link` sets `userSelect: "text"` ([Link.ts:109](../packages/lib/src/typescript/lib/component/input/Link.ts#L109)) but it is an interactive control whose whole purpose is its `"action"` click, not a read-only content surface; it is also not a `SelectableText`. Giving it a right-click menu is a separate decision about interactive controls.
- **No `MarkdownEditor` changes.** Its WYSIWYG surface already has a full Cut/Copy/Paste menu from [`markdown-editor-context-menu-clipboard.md`](implemented/markdown-editor-context-menu-clipboard.md), and it embeds no `Markdown` component.
- **No Cut and no Paste rows anywhere in this plan.** Every surface here is read-only, so the `ClipboardMenuConfig` carries only `copy` and the builder's own "no handler, no row" contract leaves the other two out.
- **No "Copy link address" row for a link inside rendered Markdown.** The menu offers exactly one row, Copy, whatever the click landed on.
- **No public `copySelection()` method** on `SelectableText` or `Markdown`. Nothing has asked for a programmatic copy, and the menu's action closes over the text captured when it opened — a method would have to re-read the selection and hit the staleness this plan avoids.
- **No `copyMenu` option on `Markdown`**, and no way to turn its menu off.
- **No consumer-extensible menu.** Neither component exposes a `contextmenu` event or a hook for extra rows; a consumer wanting more builds their own overlay.
- **No change to `getDocumentSelection()`, `getSelectionRange()`, or `buildClipboardMenuItems()`.** All three are consumed exactly as they exist.

---

## Notes

[^opt-in]: Default-on was investigated first and provably breaks two shipped table features, which is why the option exists. `Event`'s dispatcher runs exact-target listeners before its subtree walk and abandons that walk entirely once a listener returns a stop disposition ([Event.ts:292](../packages/lib/src/typescript/lib/core/Event.ts#L292)). `Body` ([:1043](../packages/lib/src/typescript/lib/component/table/Body.ts#L1043)), `HeaderCell` ([Header.ts:248](../packages/lib/src/typescript/lib/component/table/cell/Header.ts#L248)) and `ParentHeaderCell` ([ParentHeader.ts:305](../packages/lib/src/typescript/lib/component/table/cell/ParentHeader.ts#L305)) all reach their menus through *subtree* listeners, while the cell and header text they contain is a `SelectableText`. An always-on exact-target listener on `SelectableText` would therefore swallow the right-click before the table ever saw it, killing the cell menu and both column menus. The alternative fixes were each worse: an opt-*out* flag would mean editing the six cell renderers plus both header cells, which this plan is scoped away from and which would collide with [`table-cell-context-menu-clipboard.md`](table-cell-context-menu-clipboard.md); making the handler fall through only when no selection is contained would still hijack the cell menu whenever a user had selected text inside a cell first, silently changing table behaviour; and having the handler ask whether some ancestor already claims `contextmenu` would need a new `Event` query plus an ancestor walk on every right-click, and would make the menu appear and disappear based on where a consumer parented the text. The opt-in is explicit, is checkable with one `grep`, and leaves every surface this plan does not name behaving exactly as it does today.

[^wire-once]: Two shapes were compared. Having `setCopyMenu` add and remove the listener would cost nothing for the instances that never opt in — appealing, since a table body pools hundreds of `SelectableText` instances. But `applyOptions` runs inside the `super()` cascade, so the setter would register during construction, and the codebase has no precedent for `Event` wiring from a setter. `Link` has the directly analogous case and resolved it the other way, with a comment recording the reasoning: "Wired once for the component's whole life, regardless of `interactive`: handleKeyDown self-guards, so the flag needs no listener churn" ([Link.ts:162-167](../packages/lib/src/typescript/lib/component/input/Link.ts#L162)). Following the sibling class costs one map entry per instance and keeps the setter a plain cached flag, which in turn is what lets `hasCopyMenu()` be a folding getter with no `declare` field and no early-return guard to get wrong.

[^listener-shape]: `Text` renders `tag: "span"` ([Text.ts:63](../packages/lib/src/typescript/lib/component/input/Text.ts#L63)) and builds no element children — a `grep` for `createElement` / `appendChild` / `addComponent` in that file returns nothing — so a right-click anywhere on a `SelectableText` targets the span itself. `markdown-editor-context-menu.md`'s Implementation Notes record the bug from getting this wrong the other way round: `WysiwygSurface` needed a subtree listener because Lexical renders many nested spans inside one root, so the root is almost never the event target. `Markdown` is in that second category — it builds `<h1>`–`<h6>`, `<p>`, `<ul>`, `<blockquote>`, `<pre>`, `<a>` and `<table>` elements through the sink — so it needs the subtree form.

[^capture-early]: Opening a `Menu` and clicking a row are pointer gestures inside a different element, and a mousedown collapses or moves the document's selection. Re-reading the selection inside the Copy action would then read whatever the menu click left behind, not what the user had highlighted. Capturing at build time is also what the two nearest precedents do: `Body` stores the right-clicked cell in `_contextMenuCell` when the `contextmenu` event arrives rather than re-resolving it at menu-click time ([Body.ts:1991](../packages/lib/src/typescript/lib/component/table/Body.ts#L1991)), and `MarkdownEditor` stores its context-menu selection for the same reason.

[^seam-split]: `getDocumentSelection()` returns handles and character offsets, boxed so the live `Selection` never leaves the seam. Rebuilding the selected *string* from a pair of container/offset positions across arbitrary nested prose means walking the DOM and concatenating text nodes — reimplementing, badly, what `Selection.toString()` already computes. So the seam gains a member for the flattening. It does not gain one for containment: a `getSelectedTextWithin(handle)` member would have to bake in a policy choice — both endpoints, either endpoint, or `Selection.containsNode` — and that choice belongs to the component layer, not to a wrapper over a browser API. Splitting them also keeps the new member trivially implementable offline (`""`, exactly as `getDocumentSelection` returns `null`) and lets the containment rule be unit-tested through the helper with the modelled parent tree. The both-endpoints rule is the strict one on purpose: a range is contiguous in document order, so both endpoints inside a subtree means the entire range is inside it, and the string the seam hands back cannot contain a character from anywhere else on the page.

[^lazy-menu]: `TextInput` creates its `Menu` eagerly, which is fine there — a page holds a handful of text fields. `SelectableText` is different in kind: every rendered table cell in the `String`/`Number`/`Date`/`DateTime`/`Time`/`Combo` renderers holds one, the row pool keeps them alive across scrolling, and none of them will ever open this menu because none opts in. An eager `new Menu()` per instance would allocate a full overlay `Component` for each. Creating it on first right-click costs one `??=` on a path that runs at most once per component and keeps the common case free.

[^markdown-no-option]: `SelectableText` needs the flag because it is a low-level leaf that larger widgets embed inside surfaces owning their own right-click menu. `Markdown` is never such a part: it is a whole self-contained prose surface, and the only component in the library that embeds one is `MarkdownViewer` ([MarkdownViewer.ts:172](../packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L172)), which registers no `contextmenu` listener of its own and so inherits the menu correctly with no code. Adding a flag with no caller would be configurability nobody asked for.

[^no-barrel-entry]: `TextSelectionRange` needed a `core/index.ts` entry because `getSelectionRange` returns a type unique to itself, and TypeDoc warns about a documented member referencing an undocumented type. `getDocumentSelectionText` returns `string`, so there is nothing new to export and `npm run docs:api` has nothing to warn about.
