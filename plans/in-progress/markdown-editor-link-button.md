---
depends-on: [markdown-editor-toolbar-live-state]
---

# Markdown Editor Link Button — Implementation Plan

## Overview

`MarkdownDocumentPanel`'s toolbar ([MarkdownDocumentPanel.ts:124](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L124)) has five format-toggle buttons (Bold/Italic/Underline/Strikethrough/Code) but no way to add or edit a link — that command only exists today through `MarkdownEditor`'s right-click context menu (`buildLinkMenuItems`, [MarkdownEditor.ts:2606](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2606)). This plan adds a "Link" button to the toolbar, sitting right after the Code button, that opens a small popup with a URL field and an Insert/Update action, plus a Remove action while editing an existing link.

The button is a [`PopupButton`](packages/lib/src/typescript/lib/component/button/PopupButton.ts) — already shipped, already tested, no framework change needed. Its popup is a new `PopupPanel` subclass, `LinkPopupPanel`, defined and used only inside `MarkdownDocumentPanel.ts`. `PopupButton` caches whatever panel its `panel` factory returns and reuses it across opens, but `PopupPanel.showAt` — the one step `toggleFor` runs only on the branch that actually opens the panel, never the one that closes it — is a normal, already-public method a subclass can override. `LinkPopupPanel` overrides it to push the caret's current link state into its own field/buttons first, then defers to `super.showAt`, so the content is current on every open with no rebuilt tree and no change to `PopupButton`/`PopupPanel` themselves.

That live state does not exist yet: `MarkdownEditor.getSelectionState()` ([MarkdownEditor.ts:1258](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1258)) reports five format flags, table/column-alignment context, and block alignment/column count, but no link information and no "is there a selection" flag. This plan adds both to `MarkdownEditorSelectionState`, following the exact pattern the previous plan used for every other field: read fresh in `$readSelectionState()`, defaulted in `NEUTRAL_SELECTION_STATE`, compared in `selectionStatesEqual`.

---

## Architecture Decisions

### The popup refreshes via an overridden `PopupPanel.showAt`, mutating standing components in place

`PopupButton.togglePopup()` ([PopupButton.ts:200](packages/lib/src/typescript/lib/component/button/PopupButton.ts#L200)) calls `ensurePanel()` (resolves the configured `panel` factory once, ever, and caches the result) and then `panel.toggleFor(el, rect)`. `toggleFor` ([PopupPanel.ts:175](packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L175)) calls `showAt(anchorRect)` only on the branch that opens the panel; the branch that closes it returns straight from `hideAnimated()`. A `LinkPopupPanel.showAt` override that refreshes its own content before calling `super.showAt(anchorRect)` therefore runs exactly once per open and never on a close, with no subclassing of `PopupButton` and no new option on either class. The refresh itself calls `setValue`/`setText`/`setVisible` on the same `TextField`/`Button` instances every time — the same "push a snapshot into standing components" shape `MarkdownDocumentPanel.applySelectionState` already uses for the toolbar's own buttons — rather than rebuilding the content tree, since the popup's shape never changes (always one field, one or two buttons).[^showat-vs-alternatives]

### One command handles Insert and Update; the button label is cosmetic

`toggleLink(url)` ([MarkdownEditor.ts:1548](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1548)) already updates an enclosing link's URL in place instead of double-wrapping when the caret sits inside one. The popup's action always calls `editor.toggleLink(url)`; only its own label flips between "Insert link" and "Update link", exactly mirroring how `promptAndApplyLink` ([MarkdownEditor.ts:2413](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2413)) drives the same command for the context menu's "Insert link…" and "Edit link…" items.

### Submitting an empty or unchanged URL is a silent no-op

The popup does not validate or show an error. `handleSubmit` skips `onSubmit` (and still closes) when the trimmed field text is empty, or equal to the URL the popup was opened with — the identical `url !== null && url !== defaultUrl` gate `promptAndApplyLink` already applies ([MarkdownEditor.ts:2416](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2416)), so resubmitting an unedited "Edit" prompt and resubmitting an unedited popup behave the same way: nothing changes, nothing is marked dirty.

### `$readSelectionState` gains the two fields the previous plan deliberately skipped

The toolbar-live-state plan's own Architecture Decisions state that `$readSelectionState` "skips everything `$classifyContextMenuTarget` computes only for the right-click menu: `linkUrl`, `hasSelectedText`, `hasEnclosingBlock`, and the `kind` discriminant" ([plans/implemented/markdown-editor-toolbar-live-state.md:29](plans/implemented/markdown-editor-toolbar-live-state.md#L29)), because nothing on the toolbar consumed them. The Link button now consumes two of those four fields, `linkUrl` and `hasSelectedText`, so both move into `$readSelectionState`. `hasEnclosingBlock` and `kind` stay out of scope — nothing this plan adds needs them.

### `hasSelectedText` is computed inline, not factored into a second shared helper

`$classifyContextMenuTarget` already computes `hasSelectedText` as a two-line inline expression ([MarkdownEditor.ts:747-748](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L747-L748)), not through a helper. `$readSelectionState` gains the identical two lines directly, reusing the `selection`/`expansion` locals it already computes.[^why-not-a-second-helper]

### The Link button's enabled rule ORs two conditions

`applySelectionState` enables the Link button whenever there is text to wrap, or the caret is already inside a link to edit/remove — either is enough on its own:

| `hasSelectedText` | `linkUrl` | Enabled? | Why |
| --- | --- | --- | --- |
| `false` | `null` | No | Nothing to insert, nothing to edit |
| `true` | `null` | Yes | Insert: wraps the selection/word in a new link |
| `false` | a URL | Yes | Edit/Remove: caret sits inside a link, no fresh selection needed |
| `true` | a URL | Yes | Both apply; Insert/Update still targets the enclosing link (`toggleLink`'s own rule, see "One command handles Insert and Update" above) |

This is `state.hasSelectedText || state.linkUrl !== null`, reusing `Button.setEnabled` — the same mechanism `_tableBtn` already uses.

### No persistent "inside a link" highlight

The Link button's enabled state (see Public API) uses `Button.setEnabled`, never a `.contextActive`-style permanent highlight. That mechanism was added for the Table button in the plan this one follows on from, then backed out in favor of `setEnabled` once the same "just disable it" reasoning was pointed out to apply there too ([plans/implemented/markdown-editor-toolbar-live-state.md:486](plans/implemented/markdown-editor-toolbar-live-state.md#L486)). It is even less applicable here: Insert must stay usable with a plain text selection that is *not* inside a link, so "inside a link" is not the button's only enabled condition the way "inside a table" is for the Table button.

### No Enter-to-submit, no auto-focus

`Dialog`'s Enter-confirms-the-primary-button behavior ([Dialog.ts:1116-1128](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1116-L1128)) is `Dialog`-specific keydown handling tied to its own `primary` button convention; neither `PopupPanel` nor `PopupButton` has an equivalent, and adding one is a new framework mechanism this plan does not need. A user opens the popup, types or edits the URL, and clicks Insert/Update or Remove — or clicks away to cancel — all already-working interactions. See Non-Goals.

### `LinkPopupPanel` is exported from `MarkdownDocumentPanel.ts`, but not from its barrel

`export class LinkPopupPanel extends PopupPanel` lives in `MarkdownDocumentPanel.ts` and is importable by name (`~/component/editor/MarkdownDocumentPanel.js`) so tests can construct and drive it directly, without reaching through `PopupButton`'s private/protected internals. `component/editor/index.ts` is not changed, so it is not part of `@jimka/typescript-ui/component/editor`'s curated surface — the same treatment `$classifyContextMenuTarget` and `ContextMenuTarget` already get in `MarkdownEditor.ts` ([MarkdownEditor.ts:562](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L562), [:743](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L743)), for the same reason.[^exported-for-tests] It is not wrapped in `callable()`: it takes three positional callbacks, not an options bag, matching the private helper component `WysiwygSurface` ([MarkdownEditor.ts:844](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L844)) rather than a consumer-facing component.

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
    hasSelectedText: boolean;        // NEW — true for a real selection, or a collapsed caret that would expand into one
    linkUrl: string | null;          // NEW — the enclosing link's URL, or null outside one
    inTable: boolean;
    tableColumnAlignment: MarkdownTableAlignment | null;
    blockAlignment: MarkdownBlockAlignment | null;
    columnCount: number;
}
```

```typescript
// MarkdownDocumentPanel.ts

/**
 * The Link toolbar button's popup content. Exported so tests can construct
 * and drive it directly — see the "LinkPopupPanel is exported" Architecture
 * Decision. Not part of `component/editor/index.ts`'s barrel.
 */
export class LinkPopupPanel extends PopupPanel {
    constructor(
        getLinkUrl: () => string | null,
        onSubmit:   (url: string) => void,
        onRemove:   () => void,
    );

    // Overridden from PopupPanel — refreshes the field/buttons from getLinkUrl()
    // before delegating to super.showAt().
    showAt(anchorRect: Rect): this;
}
```

`MarkdownDocumentPanel`'s own public surface is unchanged — no new public members, per its existing docblock ("delegates only `getValue()`/`setValue()`/`markClean()`/the `"change"` event"). The Link button and its popup are internal wiring (a private field, a private class exported only for test access).

---

## Internal Structure

### `MarkdownEditor.ts` — the two new reads

`$readSelectionState()` ([MarkdownEditor.ts:781-796](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L781-L796)) already computes `selection`, `expansion`, and `anchor`. Add `linkUrl` from `anchor` (the same way `$classifyContextMenuTarget` derives it from its `node` parameter, [MarkdownEditor.ts:749](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L749)) and `hasSelectedText` from `selection`/`expansion` (the same expression as [MarkdownEditor.ts:747-748](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L747-L748)):

```typescript
function $readSelectionState(): MarkdownEditorSelectionState {
    const selection = $getSelection();
    const expansion = $computeWordExpansion();
    const format = $readFormatFlags(selection, expansion);
    const hasSelectedText = expansion !== null
        || ($isRangeSelection(selection) && selection.getTextContent() !== "");
    const cell = $getEnclosingTableCellNode();
    const anchor = $isRangeSelection(selection) ? selection.anchor.getNode() : null;
    const block = anchor === null ? null : $findMatchingParent(anchor, $isMarkdownBlockNode);
    const linkUrl = anchor === null ? null : ($findEnclosingLinkNode(anchor)?.getURL() ?? null);

    return {
        ...format,
        hasSelectedText,
        linkUrl,
        inTable:              cell !== null,
        tableColumnAlignment: cell !== null ? $tableCellAlignment(cell) : null,
        blockAlignment:       (block?.getAlign() ?? null) as MarkdownBlockAlignment | null,
        columnCount:          block !== null ? block.getColumns().length : 1,
    };
}
```

`NEUTRAL_SELECTION_STATE` gains `hasSelectedText: false, linkUrl: null,`. `selectionStatesEqual` gains `&& a.hasSelectedText === b.hasSelectedText && a.linkUrl === b.linkUrl`.

### `MarkdownDocumentPanel.ts` — `LinkPopupPanel`

Placed above the `MarkdownDocumentPanel` class declaration, the same relative position `WysiwygSurface` occupies above `MarkdownEditor` in its own file:

```typescript
export class LinkPopupPanel extends PopupPanel {
    private readonly _urlField:   TextField;
    private readonly _submitBtn:  Button;
    private readonly _removeBtn:  Button;
    private readonly _getLinkUrl: () => string | null;
    private readonly _onSubmit:   (url: string) => void;
    private readonly _onRemove:   () => void;

    // The URL the popup was last opened with — null outside a link, its URL
    // inside one. Set by showAt(), read by handleSubmit() to skip a no-op
    // resubmit of the same URL (mirrors promptAndApplyLink's defaultUrl check).
    private _openedWithUrl: string | null = null;

    constructor(getLinkUrl: () => string | null, onSubmit: (url: string) => void, onRemove: () => void) {
        super({ layoutManager: new VBox({ spacing: 6, stretching: true }) });

        this._getLinkUrl = getLinkUrl;
        this._onSubmit   = onSubmit;
        this._onRemove   = onRemove;

        this._urlField  = new TextField({ placeholder: "https://example.com" });
        this._submitBtn = new Button("Insert link");
        this._removeBtn = new Button("Remove link");

        this._submitBtn.on("action", () => this.handleSubmit());
        this._removeBtn.on("action", () => this.handleRemove());

        this.addComponents(
            this._urlField,
            new Component({
                layoutManager: new HBox({ spacing: 4 }),
                components:    [this._submitBtn, this._removeBtn],
            }),
        );
    }

    showAt(anchorRect: Rect): this {
        this._openedWithUrl = this._getLinkUrl();

        this._urlField.setValue(this._openedWithUrl ?? "");
        this._submitBtn.setText(this._openedWithUrl === null ? "Insert link" : "Update link");
        this._removeBtn.setVisible(this._openedWithUrl !== null);

        return super.showAt(anchorRect);
    }

    private handleSubmit(): void {
        const url = this._urlField.getValue().trim();

        if (url !== "" && url !== this._openedWithUrl) {
            this._onSubmit(url);
        }

        this.requestClose();
    }

    private handleRemove(): void {
        this._onRemove();
        this.requestClose();
    }
}
```

`requestClose()` (inherited from `AnimatedDropdown`, [AnimatedDropdown.ts:423](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L423)) runs whatever close handler is installed — `PopupButton.ensurePanel()` installs its own `closePopup` there ([PopupButton.ts:188](packages/lib/src/typescript/lib/component/button/PopupButton.ts#L188)), which also resets `aria-expanded` — or falls back to `hideAnimated()` when none is installed (e.g. a panel driven directly in a test, without a `PopupButton`).

### `MarkdownDocumentPanel.ts` — wiring

```typescript
this._linkBtn = new PopupButton<PopupButtonOptions>({
    glyph: "link", text: "Link…", showText: false,
    panel: () => new LinkPopupPanel(
        () => this._editor.getSelectionState().linkUrl,
        (url) => this._editor.toggleLink(url),
        () => this._editor.removeLink(),
    ),
});
```

```typescript
bar.addComponents(
    this._boldBtn, this._italicBtn, this._underlineBtn, this._strikethroughBtn, this._codeBtn, this._linkBtn,
    ToolBarSeparator(),
    insertBtn, this._tableBtn,
    ToolBarSeparator(),
    textStyleBtn, alignmentBtn, columnsBtn,
    Spacer.flex(),
    sourceToggle,
);
```

```typescript
private applySelectionState(state: MarkdownEditorSelectionState): void {
    this._boldBtn.setSelected(state.bold);
    this._italicBtn.setSelected(state.italic);
    this._underlineBtn.setSelected(state.underline);
    this._strikethroughBtn.setSelected(state.strikethrough);
    this._codeBtn.setSelected(state.code);
    this._linkBtn.setEnabled(state.hasSelectedText || state.linkUrl !== null);
    this._tableBtn.setEnabled(state.inTable);
}
```

The `<PopupButtonOptions>` type argument on the `PopupButton` construction is required for the same reason the file's existing comment already documents for `MenuButton` ([MarkdownDocumentPanel.ts:139-144](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L139-L144)): `PopupButton`'s options-only constructor overload accepts its generic `TOptions` directly, so an inline options literal would otherwise narrow `TOptions` to that literal's shape and fail the widening check `addComponents` applies.

---

## Ordered Implementation Steps

1. **`MarkdownEditor.ts` — extend `MarkdownEditorSelectionState`.** Add `hasSelectedText: boolean;` and `linkUrl: string | null;` to the interface ([:93-107](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L93-L107)), positioned right after `underline` and before `inTable`, each with a one-line doc comment (mirror the existing fields' style). Update the interface's own doc comment ([:85-92](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L85-L92)) to mention both.

2. **`MarkdownEditor.ts` — extend `$readSelectionState()`.** Add the `hasSelectedText` and `linkUrl` locals and include them in the returned object, per Internal Structure ([:781-796](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L781-L796)). Update the function's own doc comment ([:771-780](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L771-L780)) to mention both.
   Check: `grep -n "linkUrl" packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` now shows a hit inside `$readSelectionState` in addition to the existing `ContextMenuTarget`/`$classifyContextMenuTarget` hits.

3. **`MarkdownEditor.ts` — extend `NEUTRAL_SELECTION_STATE` and `selectionStatesEqual`.** Add `hasSelectedText: false, linkUrl: null,` to the constant ([:799-802](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L799-L802)) and the matching comparison to the function ([:813-818](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L813-L818)).

4. **`MarkdownDocumentPanel.ts` — add imports.** `Button` from `~/component/button/Button.js`; `PopupButton` from `~/component/button/PopupButton.js`; the `PopupButtonOptions` type from the same module; `PopupPanel` from `~/overlay/PopupPanel.js`; `VBox` from `~/layout/VBox.js`; `HBox` from `~/layout/HBox.js`; `Component` from `~/core/Component.js`; the `Rect` type from `~/core/DOM.js`; the `link` glyph from `~/glyphs/solid/link.js`. Add `link` to the existing `Glyph.register(...)` call ([:32](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L32)).

5. **`MarkdownDocumentPanel.ts` — add `LinkPopupPanel`.** Insert the class from Internal Structure directly above the `MarkdownDocumentPanel` class declaration ([:70](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L70)).
   Check: `npm run typecheck` compiles this class in isolation (no dependency on `MarkdownDocumentPanel` itself).

6. **`MarkdownDocumentPanel.ts` — add the `_linkBtn` field.** `private _linkBtn!: PopupButton<PopupButtonOptions>;` next to `_codeBtn`/`_tableBtn` ([:78-83](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L78-L83)).

7. **`MarkdownDocumentPanel.ts` — construct and place `_linkBtn` in `buildToolbar()`.** Add the construction from Internal Structure right after the `_codeBtn.on("action", ...)` line ([:137](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L137)), and splice `this._linkBtn` into `bar.addComponents(...)` ([:173-181](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L173-L181)) right after `this._codeBtn`, before `ToolBarSeparator()`.

8. **`MarkdownDocumentPanel.ts` — enable/disable in `applySelectionState()`.** Add `this._linkBtn.setEnabled(state.hasSelectedText || state.linkUrl !== null);` ([:379-386](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L379-L386)). Update the method's doc comment to mention the Link button's rule alongside the Table button's.

9. **`MarkdownDocumentPanel.ts` — update the two class-level doc comments.** The class docblock ([:44-69](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L44-L69)) and `buildToolbar()`'s own doc comment ([:116-123](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L116-L123)) both list the toolbar's groups ("five format toggles..., an Insert dropdown, a Table dropdown, ..."); add "a Link button" after the five format toggles in both.

10. **`markdown-document-panel.test.ts` — fix `"MarkdownDocumentPanel toolbar structure"`.** The test asserts 14 children in fixed positions ([:236-270](packages/lib/tests/component/markdown-document-panel.test.ts#L236-L270)). Update to 15: insert a `PopupButton` assertion (`toBeInstanceOf(PopupButton)`, `.getText() === 'Link…'`) at index 5, and shift every index from the old `children[5]` (the separator) onward by one (new indices 6-14).
    Check: this test fails before this step (still expects 14) and passes after.

11. **`markdown-document-panel.test.ts` — add `findPopupButton`.** Mirror `findMenuButton`/`findToggleButton` ([:72-95](packages/lib/tests/component/markdown-document-panel.test.ts#L72-L95)): `panel.getToolbar().getComponents().find((c): c is PopupButton => c instanceof PopupButton && c.getText() === text)`, throwing when absent. Import `PopupButton` from `~/component/button/PopupButton`.

12. **`markdown-document-panel.test.ts` — extend `"MarkdownDocumentPanel live toolbar state"`.** Add cases for the Link button's enabled state — see Expected Behaviour. Reuses the describe block at [:273-369](packages/lib/tests/component/markdown-document-panel.test.ts#L273-L369).

13. **`markdown-document-panel.test.ts` — add a `"MarkdownDocumentPanel Link popup"` describe block.** Import `LinkPopupPanel` and `TextField` from `~/component/editor/MarkdownDocumentPanel`/`~/component/input/TextField`, and `type { Rect }` from `~/core/DOM`. Add a local `rect(left, top, right, bottom): Rect` helper, copied from `packages/lib/tests/overlay/PopupPanel.test.ts:35-37`. Add a local `created: Array<{ dispose(): void }> = []` plus an `afterEach` that disposes it in reverse before `DOM.reset()` — copied from `packages/lib/tests/component/button/PopupButton.test.ts:26-35` — since this is the first describe block in this file to actually open/drive a `PopupPanel`, which registers with the `LayerManager` and arms a fade timer that must be torn down.[^disposal-safety] Cover the cases in Expected Behaviour.

14. **`markdown-editor.test.ts` — extend the `getSelectionState()`/`"selectionstate"` describe block ([:2008-2198](packages/lib/tests/component/markdown-editor.test.ts#L2008-L2198)).** Add `hasSelectedText: false, linkUrl: null,` to the local `NEUTRAL` constant ([:2009-2012](packages/lib/tests/component/markdown-editor.test.ts#L2009-L2012)) — every existing `.toEqual(NEUTRAL)`/`{ ...NEUTRAL, ... }` assertion keeps passing unchanged since both new fields already default correctly. Add the new cases from Expected Behaviour, using the file's own `lexicalOf`/`selectStart` helpers and the `textNode.select(2, 2)`-inside-a-link pattern already used at [:508-516](packages/lib/tests/component/markdown-editor.test.ts#L508-L516).

15. **Update docs and changelog.** See Documentation Impact.

16. **Run the full check.** `npm run typecheck`, then `npm test` for `markdown-editor.test.ts` and `markdown-document-panel.test.ts`.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-document-panel.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownDocumentPanel.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

`MarkdownEditor.getSelectionState()` (unit-testable, offline):

- Fresh `new MarkdownEditor()`: `hasSelectedText` is `false`, `linkUrl` is `null`.
- `setValue('hello world')`, caret collapsed mid-word (e.g. inside "hello"): `hasSelectedText` is `true` — the same word-expansion read `bold`/etc. already use for a collapsed caret.
- `setValue('hello world')`, caret collapsed on the space between the two words: `hasSelectedText` is `false` — no word to expand into.
- `setValue('A [text](https://old) link.')`, caret collapsed inside the link's own text node (`textNode.select(2, 2)`, mirroring [markdown-editor.test.ts:508-516](packages/lib/tests/component/markdown-editor.test.ts#L508-L516)): `linkUrl` is `"https://old"`.
- `setValue('plain text')`, caret anywhere in it: `linkUrl` is `null`.
- A drag-selected multi-cell `TableSelection` (no `RangeSelection` anchor): `hasSelectedText` is `false` and `linkUrl` is `null`, matching every other field's "not applicable" default for this case ([markdown-editor.test.ts:2104-2118](packages/lib/tests/component/markdown-editor.test.ts#L2104-L2118)).
- `on('selectionstate', fn)` fires when only `hasSelectedText`/`linkUrl` change (e.g. moving the caret from plain text into a link with no format change) — already guaranteed by `selectionStatesEqual` comparing every field, needs no new emit logic, only the comparison added in Step 3.

`MarkdownDocumentPanel` toolbar wiring (unit-testable, offline, via `findPopupButton`):

- Immediately after construction (empty document): the Link button reports `isEnabled() === false`.
- `panel.setValue('hello world')` and a non-collapsed selection spanning text: the Link button becomes `isEnabled() === true`.
- `panel.setValue('A [text](https://old) link.')`, caret collapsed inside the link's text (nothing selected): the Link button is `isEnabled() === true` anyway — the "inside a link" half of the OR.
- Caret collapsed on plain text with nothing selectable (e.g. on whitespace) and not inside a link: the Link button is `isEnabled() === false`.

`LinkPopupPanel` (unit-testable, offline, constructed directly with stub `getLinkUrl`/`onSubmit`/`onRemove` callbacks — see Step 13):

- `getLinkUrl` returning `null`: after `showAt(rect)`, the URL field's value is `""`, the first button's text is `"Insert link"`, and the second button (`getComponents()`'s button row) is not visible.
- `getLinkUrl` returning `"https://example.com"`: after `showAt(rect)`, the URL field's value is `"https://example.com"`, the first button's text is `"Update link"`, and the second button is visible.
- Setting the field to a new, non-empty value and invoking the submit handler: `onSubmit` is called once with that trimmed value.
- Setting the field to the exact URL the panel was opened with, or to `""`/whitespace-only, and invoking the submit handler: `onSubmit` is not called.
- Invoking the remove handler: `onRemove` is called once, regardless of the field's contents.
- After either handler, the panel is closed (`isOpen()` is `false`) when reached through a real `PopupButton` (the close handler is installed); driven standalone (no `PopupButton`), `requestClose()` falls back to `hideAnimated()`, so `isOpen()` is still `false`.

`MarkdownDocumentPanel`'s real wiring (unit-testable, offline, integration-style — construct the whole panel, invoke the Link button's configured factory, drive the resulting `LinkPopupPanel` directly):

- With the owned editor's caret inside an existing link, the factory's `LinkPopupPanel` — after `showAt(rect)` — prefills the field with that link's real URL (read through `getSelectionState().linkUrl`, not a stub).
- Changing the field's value and invoking the submit handler calls the owned `MarkdownEditor.toggleLink(url)` with that value.
- Invoking the remove handler calls the owned `MarkdownEditor.removeLink()`.

Not offline-testable (manual verification): the actual click-to-open interaction (`PopupButton`'s DOM `"click"` → `togglePopup()` → the popup's fade-in) and the popup's on-screen placement/sizing when the Remove row's presence changes the content height between opens. `PopupButton.test.ts`'s and `PopupPanel.test.ts`'s own test suites already cover that mechanism generically; this plan does not duplicate it.

---

## Verification

- `npm run typecheck`.
- Run `packages/lib/tests/component/markdown-editor.test.ts` and `packages/lib/tests/component/markdown-document-panel.test.ts`.
- `grep -n "hasSelectedText\|linkUrl" packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — both appear in `MarkdownEditorSelectionState`, `$readSelectionState`, `NEUTRAL_SELECTION_STATE`, and `selectionStatesEqual`, alongside the pre-existing `ContextMenuTarget`/`$classifyContextMenuTarget` occurrences.
- Manual smoke test (`npm run dev`, app at `localhost:8015` per `project_dev_urls`): open the `MarkdownEditorPanel` demo (`packages/lib/src/typescript/MarkdownEditorPanel.ts`). Select some plain text and confirm the Link button enables; click it, type a URL, click "Insert link", and confirm the text becomes a link. Click inside that link with nothing selected and confirm the Link button is still enabled, the popup now shows the URL pre-filled with "Update link" and a "Remove link" button; click "Remove link" and confirm the link is gone. Click the Link button with the caret on unselected plain text outside any link and confirm it is disabled and does not open.
- `npm run docs:api` if the project's dangling-link guard runs in CI, since `MarkdownEditorSelectionState` gains two new documented fields.

---

## Documentation Impact

- **`packages/lib/docs/components/MarkdownEditor.md`**: the "Live selection state" section ([:105-130](packages/lib/docs/components/MarkdownEditor.md#L105-L130)) enumerates the tracked fields in its opening paragraph ("the five inline-format flags..., whether it's inside a table cell and that column's alignment, and the enclosing `:::` block's alignment and column count"). Extend that sentence to mention "whether there's a selection to act on, and the URL of an enclosing link (if any)".
- **`packages/lib/docs/components/MarkdownDocumentPanel.md`**: the "Toolbar" table ([:22-30](packages/lib/docs/components/MarkdownDocumentPanel.md#L22-L30)) lists every group; add a "Link" row between "Format toggles" and "Insert" describing the popup (URL field, Insert/Update, and Remove while editing an existing link). The paragraph after the table explaining the live-state rules (the Table button's `setEnabled`, [:34](packages/lib/docs/components/MarkdownDocumentPanel.md#L34)) gets one added clause: the Link button is enabled with a text selection or while the caret is inside a link, via the same `Button.setEnabled` mechanism.
- **`packages/lib/docs/reference/changelog/next.md`**: this feature builds on `MarkdownDocumentPanel`/`getSelectionState()` bullets that are themselves still unreleased (staged in this same `next.md`, [:209-227](packages/lib/docs/reference/changelog/next.md#L209-L227)) — extend those two bullets in place rather than adding new ones, since both describe a feature area that has not shipped yet:
  - The `MarkdownDocumentPanel` bullet ([:209-217](packages/lib/docs/reference/changelog/next.md#L209-L217)): after "format toggles (Bold/Italic/Underline/Strikethrough/Code)" add ", a Link button,".
  - The `getSelectionState()` bullet ([:218-222](packages/lib/docs/reference/changelog/next.md#L218-L222)): after "the five inline-format flags" add ", whether there's a selection to act on, the enclosing link's URL (if any),".
  - The "toolbar is now live" bullet ([:223-227](packages/lib/docs/reference/changelog/next.md#L223-L227)): after "the Table button is disabled except while the caret is inside a table" add "; the Link button is enabled with a text selection or while the caret is inside a link".

`LinkPopupPanel` gets no dedicated doc page — it is an internal implementation detail exported only for tests, the same treatment `ContextMenuTarget`/`$classifyContextMenuTarget` already get.

---

## Potential Challenges

- **`PopupButton`'s generic widening footgun.** Constructing `_linkBtn` with an inline options literal and no explicit `<PopupButtonOptions>` type argument narrows `TOptions` to that literal and fails `addComponents`'s widening check — the file already has this exact problem documented for `MenuButton` ([MarkdownDocumentPanel.ts:139-144](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L139-L144)). Mitigation: use `new PopupButton<PopupButtonOptions>({...})`, per Internal Structure.
- **Test pollution from an un-disposed `PopupPanel`.** Opening (or directly `showAt`-ing) a `LinkPopupPanel` registers it with the `LayerManager` and arms an exit-fade fallback timer; forgetting to dispose it leaks into later, unrelated test files — the exact failure mode `PopupButton.test.ts`'s and `PopupPanel.test.ts`'s own file-level comments warn about. Mitigation: the `created`/`afterEach` disposal pattern in Step 13.[^disposal-safety]
- **`showAt`'s measured size depends on refresh having already happened.** If the refresh in `showAt` were accidentally placed after the `super.showAt(anchorRect)` call instead of before, the panel would measure and cap itself against the *previous* open's content (e.g. sized without the Remove button, then it appears clipped). Mitigation: the order in Internal Structure's `showAt` body — refresh first, `super.showAt` last — and the `getLinkUrl` returning `null`/non-`null` test pair in Expected Behaviour.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — Steps 1-3.
- [packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts](packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts) — Steps 4-9.
- [packages/lib/src/typescript/lib/component/button/PopupButton.ts](packages/lib/src/typescript/lib/component/button/PopupButton.ts) — the precedent this plan builds on: `ensurePanel`'s once-only cache, `togglePopup`'s open/close branches, `ensurePanel`'s `setCloseHandler` wiring that `requestClose()` relies on.
- [packages/lib/src/typescript/lib/overlay/PopupPanel.ts](packages/lib/src/typescript/lib/overlay/PopupPanel.ts) — `showAt`/`toggleFor`, the override point this plan uses.
- [packages/lib/tests/component/button/PopupButton.test.ts](packages/lib/tests/component/button/PopupButton.test.ts) — the tested/intended usage shape (`(btn as any).togglePopup()`, the `created`/`afterEach` disposal pattern) Step 13 mirrors.
- [packages/lib/tests/overlay/PopupPanel.test.ts](packages/lib/tests/overlay/PopupPanel.test.ts) — the `rect(left, top, right, bottom)` helper and direct `panel.showAt(...)` usage Step 13 copies.
- [plans/implemented/markdown-editor-toolbar-live-state.md](plans/implemented/markdown-editor-toolbar-live-state.md) — the plan this one follows on from: the `$readSelectionState`/`NEUTRAL_SELECTION_STATE`/`selectionStatesEqual` pattern Steps 1-3 extend, and the `.contextActive`-rejected-for-`setEnabled` precedent behind "No persistent 'inside a link' highlight".
- `~/.claude/CODE_CONVENTIONS.md`, `ARCHITECTURE.md` — the options-bag/`callable()` convention `LinkPopupPanel` deliberately does not use, and the general surgical-change rules this plan follows.

---

## Non-Goals

- **No Enter-key submit inside the URL field.** `Dialog`'s Enter-confirms-primary is `Dialog`-specific machinery neither `PopupPanel` nor `PopupButton` has; adding it would be a new mechanism this feature does not need (see Architecture Decisions). The Insert/Update and Remove buttons are reachable by mouse or by tabbing to them and pressing Enter/Space, same as any button.
- **No auto-focus of the URL field on open.** Not requested, and `PopupPanel.showAt`'s own mount-timing (`getElement(true)` before the panel is actually attached) makes a reliably-timed auto-focus a separate concern this plan does not solve.
- **No persistent "inside a link" highlight on the Link button.** See Architecture Decisions — the same `.contextActive` idea already rejected for the Table button, less justified here.
- **No change to the right-click context menu's existing Insert/Edit/Remove link items.** They keep using the `Dialog`-based `promptAndApplyLink` flow; this plan adds a second, toolbar-level way to reach the same `toggleLink`/`removeLink` commands, not a replacement.
- **No reordering of the toolbar's other buttons.** The Link button is inserted after Code; nothing else moves.

---

## Notes

[^showat-vs-alternatives]: Two alternatives were considered. Overriding `PopupButton.ensurePanel()` (protected, and already the panel-resolution seam) instead of `PopupPanel.showAt` would also work, but `ensurePanel()` runs on *every* `togglePopup()` call, including the one that closes the panel — refreshing content right before a close is harmless but pointless, and would need either an extra `panel.isOpen()` check to skip it (more code for no behavioural gain) or accepting the wasted work. Rebuilding the whole content tree on every open via `disposeAllComponents()` (the way `Popover.setBody` does for `FilterCell`'s variable-length condition list, [Filter.ts:542](packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L542)) is the right shape for a list whose *length* changes and pays a real disposal/reconstruction cost each time specifically to get that flexibility; this popup's shape never changes (always one field, one or two buttons), so rebuilding it would only add that cost for no benefit over updating the three standing components in place.

[^why-not-a-second-helper]: `$readFormatFlags` was extracted specifically because the format-flag logic it replaced was a real closure walking five format types ([plans/implemented/markdown-editor-toolbar-live-state.md:23-25](plans/implemented/markdown-editor-toolbar-live-state.md#L23-L25)), reused verbatim by two call sites. `hasSelectedText` is two lines with no branching; giving it the same treatment would add a function, an import at each call site, and a level of indirection for a duplication cost of two lines — not worth it per this project's "no abstractions for single-use... code" convention, especially since the second call site (`$readSelectionState`) already has `selection`/`expansion` in scope with no extra computation needed to reach them.

[^exported-for-tests]: `$classifyContextMenuTarget`'s own doc comment states it is "Exported (not part of the public `MarkdownEditor` callable) so it can be imported directly in tests, mirroring how `Markdown.test.ts` imports the non-barrel-exposed `mapFenceLangToEditorId`" ([MarkdownEditor.ts:558-561](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L558-L561)). `LinkPopupPanel` follows the same rule: a named `export` from its source file, deliberately left out of `component/editor/index.ts`, so `@jimka/typescript-ui/component/editor` consumers never see it while `markdown-document-panel.test.ts` can import and construct it directly instead of reaching through `(button as any).ensurePanel()`.

[^disposal-safety]: `PopupButton.test.ts`'s file-level comment: "dispose() runs Component.destructor(), which unregisters an open panel from the `LayerManager` module singleton AND cancels any still-running `Animation.play` fade via the pending-transition registry — an un-disposed dropdown otherwise leaves its fallback `setTimeout` armed to fire after `DOM.reset()` has released the handle it targets, corrupting a later, unrelated test file" ([PopupButton.test.ts:20-25](packages/lib/tests/component/button/PopupButton.test.ts#L20-L25)). Every existing test in `markdown-document-panel.test.ts` only reads `MenuButton.getMenuItems()`'s return value or calls a `MenuItemConfig.action()` directly — none of them ever actually shows a `Menu`/`PopupPanel` overlay — so this file has never needed the pattern before. This plan's Link-popup tests are the first to call `showAt`/`togglePopup` in this file, so they are the first that need it.
