---
depends-on:
  - markdown-editor-context-menu-clipboard
touches-shared:
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/docs/concepts/dom-seams.md
  - packages/lib/docs/reference/changelog/next.md
---

# Clipboard Context-Menu Foundation — Implementation Plan

## Overview

`Body.init` suppresses the browser's own right-click menu page-wide ([packages/lib/src/typescript/lib/core/Body.ts:102](packages/lib/src/typescript/lib/core/Body.ts#L102)). That also took away the Cut / Copy / Paste menu every native `<input>` and `<textarea>` used to get for free. `MarkdownEditor` already carries a hand-built replacement: a private `buildClipboardMenuItems(hasSelectedText)` returning three `MenuItemConfig` rows ([MarkdownEditor.ts:1527](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1527)), spread into each of its three context menus ([:1547](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1547), [:1583](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1583), [:1607](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1607)).

This plan is the first of a five-plan batch. The other four — text-input fields, table cell editing, `CodeEditor`, and read-only selectable-text surfaces — each need those same three rows, and most of them need to know whether their surface currently has text selected. This plan builds the two shared pieces the other four consume, and migrates `MarkdownEditor` onto the first of them:

1. **`buildClipboardMenuItems(config)`** — a standalone function in [`packages/lib/src/typescript/lib/component/shared/`](packages/lib/src/typescript/lib/component/shared/), beside the two cross-component helpers already there.
2. **`DOMSource.getSelectionRange(handle)`** — the read twin of the existing `DOMSink.setSelectionRange` ([DOM.ts:640](packages/lib/src/typescript/lib/core/DOM.ts#L640)), reading a text control's selected character range.

`MarkdownEditor` is the only component whose code changes, and its menus keep producing exactly the rows they produce today. No component gains a `contextmenu` handler here — see `## Non-Goals`.

---

## Architecture Decisions

### The shared builder lives in `component/shared/`, one function per file

A new file, `packages/lib/src/typescript/lib/component/shared/buildClipboardMenuItems.ts`, exports one function named after the file. It is marked `@internal` and stays out of the package barrel, mirroring [`selectionsEqual.ts:17`](packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts#L17) and [`reduceModifierSelection.ts:31`](packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts#L31) — the directory's two existing cross-component helper functions, both of which follow exactly this shape.[^shared-home]

### The config decides each row's presence by whether its handler was supplied

`buildClipboardMenuItems` takes a single `ClipboardMenuConfig` bag carrying `hasSelectedText` plus three optional handlers. A row is built only for a handler the caller passed. A read-only surface therefore omits `paste` (and `cut`) and gets no Paste row at all, rather than a dimmed one. `hasSelectedText` sets `enabled` on Cut and Copy; Paste never sets `enabled`.[^optional-handlers]

| Config | Rows produced, in order |
|---|---|
| `{ hasSelectedText: true, cut, copy, paste }` | `Cut` enabled, `Copy` enabled, `Paste` enabled |
| `{ hasSelectedText: false, cut, copy, paste }` | `Cut` disabled, `Copy` disabled, `Paste` enabled |
| `{ hasSelectedText: true, copy }` | `Copy` enabled — no Cut row, no Paste row |
| `{ hasSelectedText: false, copy }` | `Copy` disabled — no Cut row, no Paste row |
| `{ hasSelectedText: false }` | none — an empty array |

### The builder emits no trailing separator

The returned array holds rows only. A caller that follows the block with more items writes its own `{ separator: true }`, exactly as `MarkdownEditor`'s three builders do today.[^no-separator]

### `MarkdownEditor` migrates onto the shared builder through a private adapter

`MarkdownEditor.buildClipboardMenuItems` is replaced by `clipboardMenuItems(hasSelectedText)`, a private method whose whole body is one call to the shared function with the editor's three command methods as handlers. The three call sites change only in the method name they call.[^adapter]

### The seam read is `getSelectionRange(handle)` on `DOMSource`

`DOMSource` gains `getSelectionRange(handle: Handle): TextSelectionRange | null`, declared and implemented directly after `getValue` ([DOM.ts:1126](packages/lib/src/typescript/lib/core/DOM.ts#L1126) and [:2326](packages/lib/src/typescript/lib/core/DOM.ts#L2326)) — the same-subsystem form-control read it sits beside. The name is the exact read twin of `DOMSink.setSelectionRange(handle, start, end)`, and was reserved for this member by the plan that named the unrelated page-level read `getDocumentSelection` instead.[^seam-name]

### `null` means the element has no selection range; a collapsed caret is `{ start: n, end: n }`

`getSelectionRange` returns `null` when the element exposes no character range at all — a non-text `<input>` type, or any element that is not a text form control. A control that does expose one always returns a range, with `start === end` for a bare caret. So `null` and a collapsed range are different answers, mirroring how `readClipboardText()` distinguishes an unavailable read (`null`) from an empty clipboard (`""`).[^null-semantics]

| Element state | `getSelectionRange` returns | A caller reads it as |
|---|---|---|
| `<textarea>` holding `hello`, characters 1–4 selected | `{ start: 1, end: 4 }` | text selected — Cut and Copy enabled |
| `<input type="text">` with the caret after `he` | `{ start: 2, end: 2 }` | caret only — Cut and Copy dimmed |
| `<input type="text">`, empty and focused | `{ start: 0, end: 0 }` | caret only |
| `<input type="number">` | `null` | this control has no character range |
| a `<div>` | `null` | not a text form control |

### The offline seam models the range rather than reporting nothing

`RecordingDOMSink.setSelectionRange` folds the written range onto the shared handle stub, and `ModelledDOMSource.getSelectionRange` reads it back — the same write-visible-to-read shape `setValue` / `getValue` already has ([TestDOM.ts:537](packages/lib/tests/dom/TestDOM.ts#L537) and [:1119](packages/lib/tests/dom/TestDOM.ts#L1119)). A handle nothing has written to reports `null`.[^modelled-not-stubbed]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/shared/buildClipboardMenuItems.ts

/** Which clipboard rows a surface offers, and what each one does. */
export interface ClipboardMenuConfig {
    /** Whether the surface has text selected right now. Sets `enabled` on Cut and Copy. */
    hasSelectedText: boolean;
    /** Runs the Cut command. Omit to leave the Cut row out entirely. */
    cut?:   () => void;
    /** Runs the Copy command. Omit to leave the Copy row out entirely. */
    copy?:  () => void;
    /** Runs the Paste command. Omit to leave the Paste row out entirely. */
    paste?: () => void;
}

export function buildClipboardMenuItems(config: ClipboardMenuConfig): MenuItemConfig[];
```

```typescript
// packages/lib/src/typescript/lib/core/DOM.ts — added to the DOMSource interface,
// implemented by ProductionDOMSource (and by ModelledDOMSource in the test harness).

/** The selected character range inside a text form control. */
export interface TextSelectionRange {
    /** Character offset of the range's start. */
    start: number;
    /** Character offset of the range's end. Equal to `start` for a bare caret. */
    end:   number;
}

getSelectionRange(handle: Handle): TextSelectionRange | null;
```

`TextSelectionRange` must be added to the `export type { … } from '~/core/DOM.js';` line at [core/index.ts:14](packages/lib/src/typescript/lib/core/index.ts#L14), beside `DocumentSelectionRange`. A `DOMSource` return type that is not itself reachable from an entry point makes `npm run docs:api` warn.[^barrel-export]

Changed on `MarkdownEditor`: the private `buildClipboardMenuItems(hasSelectedText: boolean)` becomes the private `clipboardMenuItems(hasSelectedText: boolean)`. Both are private; neither appears in the public API docs.

No new state-bearing property, so no accessor, backing field, or options entry is involved anywhere in this plan.

---

## Internal Structure

The shared module, minus the `ClipboardMenuConfig` interface given in `## Public API`:

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { MenuItemConfig } from "~/component/container/MenuItem.js";

export function buildClipboardMenuItems(config: ClipboardMenuConfig): MenuItemConfig[] {
    const items: MenuItemConfig[] = [];

    if (config.cut) {
        items.push({ text: "Cut", enabled: config.hasSelectedText, action: config.cut });
    }

    if (config.copy) {
        items.push({ text: "Copy", enabled: config.hasSelectedText, action: config.copy });
    }

    if (config.paste) {
        items.push({ text: "Paste", action: config.paste });
    }

    return items;
}
```

`ProductionDOMSource.getSelectionRange`, placed directly after its `getValue` ([DOM.ts:2326-2328](packages/lib/src/typescript/lib/core/DOM.ts#L2326)):

```typescript
/** @inheritDoc */
getSelectionRange(handle: Handle): TextSelectionRange | null {
    const el    = _registry.resolve(handle) as HTMLInputElement;
    const start = el.selectionStart;
    const end   = el.selectionEnd;

    // `typeof`, not `!== null`: the DOM types say `number | null`, but reading
    // the property off an element that is not a form control at all yields
    // `undefined` at runtime.
    if (typeof start !== "number" || typeof end !== "number") {
        return null;
    }

    return { start, end };
}
```

`ModelledDOMSource.getSelectionRange`, placed directly after its `getValue` ([TestDOM.ts:1119](packages/lib/tests/dom/TestDOM.ts#L1119)):

```typescript
/**
 * Reads the range recorded onto the stub by the recording sink's
 * `setSelectionRange`. Returns a copy so a caller cannot mutate the stub
 * through the snapshot; `null` when no range was ever written.
 */
getSelectionRange(handle: Handle): TextSelectionRange | null {
    const range = _table.stub(handle).selection;

    return range === null ? null : { ...range };
}
```

`RecordingDOMSink.setSelectionRange` ([TestDOM.ts:542](packages/lib/tests/dom/TestDOM.ts#L542)) keeps its existing `record` call and gains the fold:

```typescript
setSelectionRange(handle: Handle, start: number, end: number): void {
    this.record('setSelectionRange', start, end);
    _table.stub(handle).selection = { start, end };
}
```

The handle stub gains one field, added to the `HandleStub` interface ([TestDOM.ts:61](packages/lib/tests/dom/TestDOM.ts#L61)) and seeded in `TestHandleTable.mint` ([TestDOM.ts:134](packages/lib/tests/dom/TestDOM.ts#L134)):

```typescript
/**
 * Modelled text-selection range, folded by the recording sink's
 * `setSelectionRange` and read back by
 * {@link ModelledDOMSource.getSelectionRange}. `null` (the default) models an
 * element with no character range — a non-text control, or a control nothing
 * has written a range to.
 */
selection: { start: number; end: number } | null;
```

`MarkdownEditor`'s adapter replaces the current private builder ([MarkdownEditor.ts:1527](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1527)) in place:

```typescript
private clipboardMenuItems(hasSelectedText: boolean): MenuItemConfig[] {
    return buildClipboardMenuItems({
        hasSelectedText,
        cut:   () => this.cut(),
        copy:  () => this.copy(),
        paste: () => void this.pasteAtContextMenuSelection(),
    });
}
```

The existing doc comment on the removed method explains why Cut and Copy dim on a hypothetical word expansion; keep that comment on the adapter, dropping only its `@param`/`@returns` restatement of what the shared function now documents.

---

## Ordered Implementation Steps

1. **Add the seam member to `DOMSource`.** In [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts): declare `getSelectionRange(handle: Handle): TextSelectionRange | null;` in the `DOMSource` interface directly after `getValue` ([:1126](packages/lib/src/typescript/lib/core/DOM.ts#L1126)), with JSDoc stating that `null` means the element exposes no character range and that a bare caret returns `start === end`. Add the exported `TextSelectionRange` interface beside `DocumentSelectionRange` ([:1488](packages/lib/src/typescript/lib/core/DOM.ts#L1488)), carrying the `@category Core` tag its neighbour has. Implement `getSelectionRange` in `ProductionDOMSource` directly after that class's own `getValue` ([:2326](packages/lib/src/typescript/lib/core/DOM.ts#L2326)), from `## Internal Structure`.
   *Check:* `grep -n "getSelectionRange" packages/lib/src/typescript/lib/core/DOM.ts` — at least two matches: the `DOMSource` declaration and the `ProductionDOMSource` implementation.

2. **Export the new type from the core barrel.** Add `TextSelectionRange` to the `export type { … } from '~/core/DOM.js';` list at [`packages/lib/src/typescript/lib/core/index.ts:14`](packages/lib/src/typescript/lib/core/index.ts#L14), next to `DocumentSelectionRange`.

3. **Implement the seam member offline.** In [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts): add `type TextSelectionRange` to the `import { DOM, type DOMSink, type DOMSource, type DocumentSelectionRange, … } from '~/core/DOM';` line at the top of the file; add the `selection` field to `HandleStub` ([:61](packages/lib/tests/dom/TestDOM.ts#L61)) and seed it `null` in `TestHandleTable.mint` ([:134](packages/lib/tests/dom/TestDOM.ts#L134)); add the stub fold to `RecordingDOMSink.setSelectionRange` ([:542](packages/lib/tests/dom/TestDOM.ts#L542)); add `ModelledDOMSource.getSelectionRange` after that class's `getValue` ([:1119](packages/lib/tests/dom/TestDOM.ts#L1119)). All three snippets are in `## Internal Structure`.
   *Check:* `npm run typecheck` and `npm -w packages/lib run typecheck:test` both pass. `grep -rn "implements DOMSource" packages/lib/src packages/lib/tests` returns exactly two lines — the only two implementations that had to be updated.

4. **Create `packages/lib/tests/dom/selection-range.test.ts`.** Cover behaviours 1–6 of `## Expected Behaviour`. Follow [`tests/dom/seam-predicates.test.ts`](packages/lib/tests/dom/seam-predicates.test.ts) for the file shape: the same `CONFIG` literal, `installTestDOM(CONFIG)` per case, and `afterEach(() => DOM.reset())`. Mint handles with `DOM.sink.createElement('input')`.
   *Check:* `cd packages/lib && npx vitest run tests/dom/selection-range.test.ts` — green.

5. **Write the builder tests (red).** Create `packages/lib/tests/component/shared/buildClipboardMenuItems.test.ts`, covering behaviours 7–13. It is a pure test with no DOM and no `installTestDOM`, mirroring [`tests/component/shared/selectionsEqual.test.ts`](packages/lib/tests/component/shared/selectionsEqual.test.ts) — plain `describe`/`it`, `vi.fn()` for the handlers. It fails to compile until Step 6.

6. **Create the shared builder.** Add `packages/lib/src/typescript/lib/component/shared/buildClipboardMenuItems.ts` from `## Internal Structure`. Give `ClipboardMenuConfig` the per-field JSDoc from `## Public API`. Give the function a JSDoc that states the presence-and-enablement rule from the table in `## Architecture Decisions`, carries `@param config` and `@returns`, and closes with `@internal Shared by every component offering clipboard actions in its right-click menu; not barrel-exported.` — the same closing tag line both neighbours in that directory carry.
   *Check:* Step 5's tests go green.

7. **Migrate `MarkdownEditor`.** In [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): add `import { buildClipboardMenuItems } from "~/component/shared/buildClipboardMenuItems.js";` beside the existing `~/component/container/MenuItem.js` import ([:12](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L12)); replace the private `buildClipboardMenuItems` body with the `clipboardMenuItems` adapter from `## Internal Structure`; update the three call sites ([:1547](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1547), [:1583](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1583), [:1607](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1607)) to `...this.clipboardMenuItems(context.hasSelectedText),`.
   *Check:* `grep -n "this.buildClipboardMenuItems" packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — zero matches. `cd packages/lib && npx vitest run tests/component/markdown-editor.test.ts` — green with **no test edits**, which is what proves the migration changed no behaviour (behaviour 14).

8. **Full check.** `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`, `npm run lint`, `npm run docs:api` (zero warnings).

9. **Docs.** Apply every edit in `## Documentation Impact`, per the `document` skill.

10. **Manual smoke test.** Behaviour 15, in the running demo app.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Create | `packages/lib/src/typescript/lib/component/shared/buildClipboardMenuItems.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/dom/selection-range.test.ts` |
| Create | `packages/lib/tests/component/shared/buildClipboardMenuItems.test.ts` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

`packages/lib/tests/component/markdown-editor.test.ts` is deliberately **not** in this table: Step 7 must leave it passing unedited.

---

## Expected Behaviour

**Unit-testable — the seam member** (`tests/dom/selection-range.test.ts`, under `installTestDOM`):

1. After `DOM.sink.setSelectionRange(h, 1, 4)`, `DOM.source.getSelectionRange(h)` returns `{ start: 1, end: 4 }`.
2. A handle nothing has written a range to returns `null`.
3. A collapsed write — `DOM.sink.setSelectionRange(h, 2, 2)` — returns `{ start: 2, end: 2 }`, not `null`.
4. A later write replaces the earlier one: `(h, 1, 4)` then `(h, 0, 0)` reads back `{ start: 0, end: 0 }`.
5. The result is a copy — mutating the returned object's `start` does not change what a second `getSelectionRange(h)` call returns.
6. The write is still recorded: `sink.writes` contains `{ op: 'setSelectionRange', args: [1, 4] }` after case 1, so the fold did not displace the existing op log entry.

**Unit-testable — the shared builder** (`tests/component/shared/buildClipboardMenuItems.test.ts`, pure):

7. `{ hasSelectedText: true, cut, copy, paste }` returns three rows whose `text` values are `"Cut"`, `"Copy"`, `"Paste"` in that order.
8. With `hasSelectedText: true`, the Cut and Copy rows carry `enabled: true`.
9. With `hasSelectedText: false`, the Cut and Copy rows carry `enabled: false`.
10. The Paste row never sets `enabled` — it is `undefined` for both values of `hasSelectedText`.
11. `{ hasSelectedText: true, copy }` returns exactly one row, `"Copy"`, with `enabled: true`; `{ hasSelectedText: false, copy }` returns exactly one row, `"Copy"`, with `enabled: false`.
12. `{ hasSelectedText: false }` returns an empty array.
13. Invoking each row's `action` calls the matching handler exactly once, and no other handler.

**Unit-testable — the migration** (existing file, no edits):

14. Every case in `describe('MarkdownEditor context menu')` ([markdown-editor.test.ts:1214](packages/lib/tests/component/markdown-editor.test.ts#L1214)) passes unchanged — the 12 / 13 / 9 item counts, the leading `Cut, Copy, Paste, (separator)` order in all three contexts, and the `Bold` checkbox row still sitting at index 4.

**Manual** (`npm run dev`, app on `localhost:8015`, the demo's **MD Editor** section):

15. Right-clicking a word still opens a menu leading with Cut / Copy / Paste; Cut and Copy act on the word; right-clicking an empty line still dims Cut and Copy.

---

## Verification

- `npm run typecheck` and `npm -w packages/lib run typecheck:test` — clean.
- `cd packages/lib && npx vitest run tests/dom/selection-range.test.ts tests/component/shared/buildClipboardMenuItems.test.ts tests/component/markdown-editor.test.ts` — all green, with `markdown-editor.test.ts` unedited.
- `npm test` — the whole suite; no regression.
- `npm run lint` — clean. `selectionStart` / `selectionEnd` are read only inside `ProductionDOMSource`, so `local/no-raw-dom` stays at its empty baseline. Confirm with `grep -rn "selectionStart" packages/lib/src` — hits in `core/DOM.ts` only.
- `grep -rn "getSelectionRange\|TextSelectionRange" packages/lib/src packages/lib/tests` — hits only in `core/DOM.ts`, `core/index.ts`, `tests/dom/TestDOM.ts`, and `tests/dom/selection-range.test.ts`.
- `grep -rn "buildClipboardMenuItems" packages/lib/src` — hits only in `component/shared/buildClipboardMenuItems.ts` and `component/editor/MarkdownEditor.ts` (its import plus the one call inside `clipboardMenuItems`), and none of them is a `this.` call.
- `npm run docs:api` — zero warnings. This is the check that catches a missing barrel entry for `TextSelectionRange`.
- `npm run build:docs` — clean VitePress build.
- Manual case 15 above.

---

## Documentation Impact

`DOM`, `DOMSource`, and `Handle` are already exported and documented, so the new seam member needs no sidebar or page change — but its return type does need the barrel entry in Step 2, or TypeDoc warns that `TextSelectionRange` is referenced but not documented.

- **[`packages/lib/docs/concepts/dom-seams.md:49`](packages/lib/docs/concepts/dom-seams.md#L49)** — the *Scroll, box-model, and form-control access is keyed on a handle* section lists what the handle-keyed reads cover: "native scroll offset, scrollable overflow size, offset box, connection state, input value". Extend that list with a text control's selected character range, and add one sentence naming `getSelectionRange` as `setSelectionRange`'s read twin, returning `null` for an element that exposes no character range.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — the `## Breaking changes` → `### Core` subsection already holds the `readClipboardText()` entry. Add a second bullet in the same shape: "**`DOMSource` gains one required member: `getSelectionRange()`.** Only a consumer implementing its own `DOMSource` is affected."
- **No `## Added` changelog entry and no new doc page for the builder.** `buildClipboardMenuItems` is `@internal` and not barrel-exported, so no consumer can see it, and `MarkdownEditor`'s menus are unchanged.
- **`packages/lib/llms.txt` needs no change** — it is generated from `scripts/llms/manifest.data.mjs` and indexes capabilities and hard rules, neither of which this adds. Do not regenerate it.

---

## Potential Challenges

- **The seam member has no production caller until the next plan in this batch lands.** Nothing in `packages/lib/src` calls `getSelectionRange` when this plan ships, so a wrong shape would go unnoticed by typecheck. `tests/dom/selection-range.test.ts` is the only guard, which is why behaviours 1–6 pin the contract rather than a caller's use of it.
- **`selectionStart` is typed `number | null` but is `undefined` on a non-form element.** A `!== null` guard would let `undefined` through and produce `{ start: undefined, end: undefined }`. The `typeof … !== "number"` check in `## Internal Structure` is what handles both.
- **Reading `selectionStart` is safe where writing a range is not.** `DOMSink.setSelectionRange` throws on an `<input type="number">`; the getter returns `null` there instead, which is exactly the `null` this member reports.
- **ARCHITECTURE.md's "listeners must reference a named function" rule does not reach `MenuItemConfig.action`.** It governs `Event.addListener` / `addSubtreeListener` / `addViewportListener` registrations, which are removable by reference. Menu actions are plain callbacks and every existing item in `MarkdownEditor`'s menus already uses an arrow; the adapter keeps that.
- **The private-method rename could break a white-box test.** It does not: `contextMenuMethodsOf` ([markdown-editor.test.ts:95](packages/lib/tests/component/markdown-editor.test.ts#L95)) names `buildContextMenuItems`, `handleWysiwygContextMenu`, and `pasteAtContextMenuSelection` only. Confirm with `grep -n "buildClipboardMenuItems" packages/lib/tests` — zero matches before and after.
- **A new required `DOMSource` member is a breaking change for a consumer with its own implementation.** The changelog entry under `## Breaking changes` → `### Core` is the mitigation, matching how `readClipboardText` was announced.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts`](packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts) and [`reduceModifierSelection.ts`](packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts) — the precedent the new module copies: one exported function per file, named after the file, `@internal` and not barrel-exported. Read both before creating the third.
- [`packages/lib/tests/component/shared/selectionsEqual.test.ts`](packages/lib/tests/component/shared/selectionsEqual.test.ts) — the matching pure-test shape for the new builder test.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `DOMSink.setSelectionRange` (:640, :1788) is the write twin; `getValue` (:1126, :2326) is the same-subsystem read the new member sits beside; `DocumentSelectionRange` (:1488) is the exported-return-type precedent; `readClipboardText` (:1151, :2357) is the `null`-versus-empty precedent.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `HandleStub` (:61), `TestHandleTable.mint` (:134), `RecordingDOMSink.setValue` (:537) and `setSelectionRange` (:542), `ModelledDOMSource.getValue` (:1119), and `getMediaState` (:1312), whose "return a copy so a caller cannot mutate the stub" comment the new read reuses.
- [`packages/lib/tests/dom/seam-predicates.test.ts`](packages/lib/tests/dom/seam-predicates.test.ts) — the `installTestDOM` + `afterEach(() => DOM.reset())` file shape the new seam test follows.
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `buildClipboardMenuItems` (:1527) and its three call sites (:1547, :1583, :1607); `copy` (:1059), `cut` (:1087), `paste` (:1109), and `pasteAtContextMenuSelection` (:1464) are the handlers the adapter passes.
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts:53`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L53) — `MenuItemConfig`, for `text` / `action` / `enabled` semantics.
- [`packages/lib/docs/concepts/dom-seams.md`](packages/lib/docs/concepts/dom-seams.md) — the read/write split that puts this read on `DOMSource` even though its twin is on the sink.
- [`plans/implemented/markdown-editor-context-menu-clipboard.md`](plans/implemented/markdown-editor-context-menu-clipboard.md) — where the builder and the three commands came from; its `## Implementation Notes` record two corrections that the current code already carries.
- [`plans/implemented/native-context-menu-suppression.md`](plans/implemented/native-context-menu-suppression.md) — why native text inputs lost their clipboard menu in the first place.

---

## Non-Goals

- **No changes to `TextInput`, `TextField`, `PasswordField`, `UsernameField`, `TextArea`, `PickerInput`, any table cell editor, or `CodeEditor`.** Each is the subject of its own plan in this batch; wiring any of them here would pre-empt those plans' own design.
- **No new `contextmenu` handler anywhere.** This plan adds no menu to any component. `MarkdownEditor`'s existing menu is the only one that calls the shared builder when this ships.
- **No barrel export or public doc page for `buildClipboardMenuItems`.** It is library-internal, like both of its neighbours in `component/shared/`.
- **No shortcut hints and no glyphs on the three rows.** The rows carry `text`, `action`, and (for Cut and Copy) `enabled` only, keeping the migration behaviour-neutral; the reason the original builder skipped them — that `Ctrl` versus `Cmd` is platform-dependent and the framework has no platform-detection helper — is unchanged.
- **No separate Paste-enablement axis.** A caller that wants no Paste omits the handler; there is no "present but dimmed" Paste. Adding one would need a consumer that wants it, and none of the four downstream plans has been designed yet.
- **No change to `getDocumentSelection()`.** The page-level selection read is a different concept — the whole document's selection, not one control's character range — and stays exactly as it is.
- **No multi-range selection support.** `getSelectionRange` reads a single form control's one range; there is no multi-range concept on an `<input>` to model.
- **No change to `DOMSink.setSelectionRange`'s signature or to its one call site** at [`TextInput.ts:640`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L640). Only the offline sink's body changes, and only to fold the write onto the stub.

---

## Notes

[^shared-home]: `packages/lib/src/typescript/lib/component/shared/` is the directory this codebase already uses for logic several unrelated components share, and both of its function files (`selectionsEqual.ts`, `reduceModifierSelection.ts`) are exactly this shape — one exported function, file named after it, an `@internal Shared by …; not barrel-exported.` tag closing the JSDoc, and a matching pure test under `packages/lib/tests/component/shared/`. `core/` was the other candidate and was rejected: it holds framework primitives (`Component`, `Event`, `DOM`, `Panel`), and a menu-item builder must import `MenuItemConfig` from `component/container/MenuItem.js`, so putting it there would point `core` at `component` for no gain. Leaving the function on `MarkdownEditor` and having four other components reach into it was never an option — `Event`-style cross-component reach-in is forbidden by ARCHITECTURE.md, and a private method is not importable anyway.

[^optional-handlers]: Three axes were possible: presence, enablement, and the handler. An earlier shape used a required `editable: boolean` alongside three required handlers, and was rejected on a concrete case — a read-only selectable-text surface (`Text`, `SelectableText`, the `Markdown` viewer) has no `cut()` or `paste()` method to hand over at all, so a required-handler contract would force it to invent two dead callbacks purely to satisfy the type. Making the handlers optional collapses presence and handler into one decision and drops `editable` entirely: a caller passes what it can do. The remaining flag, `hasSelectedText`, is the one thing the builder genuinely cannot derive — only the caller knows whether its surface has a selection — and it is the same flag `MarkdownEditor` already computes in `$classifyContextMenuTarget`. Dimming rather than hiding Cut and Copy when nothing is selected is the platform convention every desktop editor follows, and is what the current builder already does.

[^no-separator]: `MarkdownEditor`'s three menus each follow the clipboard block with `{ separator: true }` and then more items, so the separator looks like part of the block. It is not: a surface whose entire menu is Cut / Copy / Paste — the likely shape for a plain text field — would render a rule under its last row with nothing beneath it. Composition stays with the caller, which is also how `buildFormatToggleItems` already behaves in the same file.

[^adapter]: The alternative was to inline the four-line config literal at each of the three call sites, which would triple it and put the editor-specific reasoning — that Cut and Copy dim against a *hypothetical* word expansion that `cut()`/`copy()` then perform themselves — in three places or none. A one-line adapter keeps that comment in one place and keeps the three call sites a pure rename, so the existing menu tests are a real regression check rather than a rewritten one. The adapter is used three times, so it is not an abstraction over single-use code. It is named `clipboardMenuItems` rather than keeping `buildClipboardMenuItems` so that a reader (and a `grep`) can tell the editor's adapter from the shared function it calls.

[^seam-name]: `docs/concepts/dom-seams.md` opens with the organising rule: every DOM write funnels through `DOMSink` and every read through `DOMSource`, split by direction and not by subsystem. The seam already splits several same-subsystem pairs this way — `setValue`/`getValue`, `setScrollLeft`/`getScrollLeft`, `setLocationHash`/`getLocationHash` — so `setSelectionRange` living on the sink is what makes `getSelectionRange` belong on the source, not an argument against it. The name is available and unambiguous by an earlier decision: `table-copy-clipboard-format.md`'s `[^naming]` footnote records that the page-level read was named `getDocumentSelection()` specifically "to avoid confusion with the unrelated `DOMSink.setSelectionRange(handle, start, end)`, which sets a single `<input>` element's own native text-cursor range — a different concept". That reserved `getSelectionRange` for exactly this member. `TextSelectionRange` names the return type for the same reason: `DocumentSelectionRange` is the document-level struct and the two must not read as variants of one thing.

[^null-semantics]: Three candidate contracts were compared. Returning `null` for a collapsed caret (the shape `getDocumentSelection` uses) would throw away the caret offset, which is precisely what a text-input Paste implementation needs to know where to insert — and it would make "no selection" and "not a text control" indistinguishable. Returning `{ start: 0, end: 0 }` for a non-text control would be a lie a caller cannot detect. Reporting `null` only for the genuinely unanswerable case, and a real range otherwise, keeps both distinctions and mirrors `readClipboardText`'s `null` (the read is not available) versus `""` (the read succeeded and found nothing). A caller asking "is there something to cut?" writes `range !== null && range.start !== range.end`.

[^modelled-not-stubbed]: `ModelledDOMSource.getDocumentSelection` returns `null` unconditionally because there is no browser `Selection` offline to model. This read is different: its write twin already exists on the sink, so folding the written range onto the shared handle stub makes the pair round-trip with no browser — the same trick `setValue`/`getValue` already play through `HandleStub.value`. That is what lets behaviours 1–6 be real assertions rather than a check that a stub still returns `null`, and it is what gives the four downstream plans a working offline harness for selection-dependent menu state. A separate exported seeding helper (the shape `setBorderInset` / `setScrollExtent` / `setMediaState` use) was considered and rejected as redundant: `DOM.sink.setSelectionRange(handle, start, end)` already is the seeder, and a second entry point would let a test seed state no production write could produce.

[^barrel-export]: `table-copy-clipboard-format.md`'s `## Implementation Notes` record this exact trap being hit and fixed. Its `## Documentation Impact` claimed no barrel change was needed for `DocumentSelectionRange`; `npm run docs:api` then warned that the type is "referenced by `core.ProductionDOMSource.getDocumentSelection` but not included in the documentation", and the fix was adding it to `core/index.ts`'s `export type { … }` line. `getValue` never needed one because it returns `string`. `getSelectionRange` returns a type unique to itself, so it needs the same entry, and Step 2 does it up front rather than after the warning.
