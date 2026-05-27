# AutoComplete List-Backed Dropdown — Implementation Plan

## Overview

Replace [`AutoCompleteDropdown`](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L39)'s in-file `AutoCompleteItem` row pool with a hosted [`List`](../src/typescript/lib/component/list/List.ts#L30) instance. The dropdown becomes a thin [`AnimatedDropdown`](../src/typescript/lib/core/AnimatedDropdown.ts#L108) wrapper containing one `List` configured for the typeahead UX — the row pool, click-commit gesture, ARIA `option`-role wiring, and the rendered chrome (hover, focused, separator) all delegate to [`AbstractCustomList`](../src/typescript/lib/component/list/AbstractCustomList.ts#L392), which already implements every behaviour `AutoCompleteDropdown` currently re-implements.

This mirrors the shipped [`combobox-list-dropdown`](implemented/combobox-list-dropdown.md) refactor — `setItemsArray`, [`setFocusOnRowClick`](../src/typescript/lib/component/list/AbstractCustomList.ts#L991), [`handleKey`](../src/typescript/lib/component/list/AbstractCustomList.ts#L1012), the host-forwarded keystroke pattern, and the `.<Dropdown> .List:focus::after { content: none }` rule are all already present. The one piece this plan adds to the shared list surface is a `setSelectFollowsFocus(boolean)` toggle — autocomplete's keyboard navigation moves a *highlight* without committing it as the *selection*, which is the [WAI-ARIA combobox-with-list-autocomplete](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) pattern's "selection-follows-focus = false" mode.

The change deletes [`AutoCompleteItem.ts`](../src/typescript/lib/component/input/AutoCompleteItem.ts) entirely (~196 lines), shrinks [`AutoCompleteDropdown.ts`](../src/typescript/lib/component/input/AutoCompleteDropdown.ts) to roughly ~90 lines (from 297), and replaces ~40 lines of `highlightNext` / `highlightPrev` / `selectHighlighted` plumbing in [`AutoCompleteField.onKeyDown`](../src/typescript/lib/component/input/AutoCompleteField.ts#L419-L459) with a single `dropdown.handleKey(e)` forward.

---

## Architecture Decisions

### Embed a `List` instance — same composition shape as `ComboBoxDropdown`

The same reasoning from `combobox-list-dropdown.md` applies: `List` is an in-flow input that participates in a form; the dropdown is a floating overlay with its own positioning math and fade lifecycle. Composition is the clean shape — `AutoCompleteDropdown` extends `AnimatedDropdown` (no behaviour change) and contains one `List` filling its `Fit` layout.

### Selection-follows-focus = false — new `setSelectFollowsFocus` toggle on `AbstractCustomList`

Autocomplete's contract diverges from `ComboBox`'s in exactly one way: ArrowUp/Down should move a *highlight* without committing the row as the surface value. Only Enter / Space / click commits.

`AbstractCustomList` already represents this distinction internally — [`_focusedIndex`](../src/typescript/lib/component/list/AbstractCustomList.ts#L402) is the keyboard cursor; `_selectedSet` is the committed selection. The keyboard reducer [`moveFocus`](../src/typescript/lib/component/list/AbstractCustomList.ts#L1151) currently runs `reduceSelection` + `notifyUserChange` on every navigation when `ctrl` is false ("selection follows focus" — the default), and skips both when `ctrl` is true ("browse without committing"). A new `_selectFollowsFocus` boolean field — default true — toggles this behaviour for the whole list rather than per-key. `AutoCompleteDropdown` flips it off on its inner list at construction.

Rejected alternative: pipe a `mode: 'browse' | 'commit'` parameter through `handleKey` and `handleNavigationKey`. Adds an API axis to every key forward; the per-instance flag is a smaller, more testable surface.

### `selectFollowsFocus` only gates navigation keys — Enter / Space / click still commit

The flag toggles `moveFocus`'s `reduceSelection` + `notifyUserChange` calls only. Click commits run through [`handleRowClick`](../src/typescript/lib/component/list/AbstractCustomList.ts#L954) → `reduceSelection` → `notifyUserChange`; keyboard commits run through [`commitFocusedRow`](../src/typescript/lib/component/list/AbstractCustomList.ts#L1174) → `reduceSelection` → `notifyUserChange`. Neither path consults `_selectFollowsFocus`. So Enter still fires `change`, the click still fires `change`, ArrowDown does not. This matches the autocomplete UX exactly.

### Suggestions land via `setItemsArray` with `key === label`

[`AbstractCustomList.setItems(string[])`](../src/typescript/lib/component/list/AbstractCustomList.ts#L566) auto-keys items as `{ key: String(i), label: s }`. Autocomplete needs `getValue()` to return the *suggestion text*, not the index — the easiest shape is `setItemsArray(suggestions.map(s => ({ key: s, label: s })))`. The list's `getValue` then returns the picked suggestion directly. The public method already exists on [`List`](../src/typescript/lib/component/list/List.ts#L90) (added by `combobox-list-dropdown`); no widening needed.

### Host forwards keystrokes — list never takes DOM focus

The plumbing shipped with the ComboBox refactor — [`AbstractCustomList.handleKey`](../src/typescript/lib/component/list/AbstractCustomList.ts#L1012) is the public entry point hosts call from their own `keydown`, and [`setFocusOnRowClick(false)`](../src/typescript/lib/component/list/AbstractCustomList.ts#L991) keeps the embedded list from stealing focus on a row click. `AutoCompleteDropdown` reuses both — the TextField keeps focus while the dropdown is open, and `AutoCompleteField.onKeyDown` forwards navigation / commit keys via `_dropdown.handleKey(e)` instead of focusing the list.

Note: `handleKey` does NOT consume Escape ([AbstractCustomList.ts:1021](../src/typescript/lib/component/list/AbstractCustomList.ts#L1021)) — that stays on the host so it can close the dropdown. Same contract as ComboBox.

### Type-ahead is fed by the host, not the list

`handleKey` consumes printable single characters and feeds them into the list's type-ahead buffer. For autocomplete this would double-fire alongside the TextField's `input` event (which already drives `querySuggestions`). Mitigation: `AutoCompleteField.onKeyDown` only forwards a narrow allow-list (`ArrowDown`, `ArrowUp`, `Enter`, `Tab`) to `dropdown.handleKey` — printable characters bypass the forward and fall through to the TextField's `input` handler. The list's type-ahead branch is never reached.

### `aria-activedescendant` on the TextField mirrors the list's focused row

Today [`AutoCompleteField.updateActiveDescendant`](../src/typescript/lib/component/input/AutoCompleteField.ts#L590) reads `dropdown.getHighlightedId()`. After the refactor the list owns the focused row; expose `getFocusedRowId(): string | null` on `AbstractCustomList` so the field can keep writing `aria-activedescendant` after each forwarded key without coupling to the row-pool internals. Internally this just returns the focused row's framework-generated id (the same value `updateActiveDescendant` writes into the list root's own ARIA attribute today — see [AbstractCustomList.ts:918](../src/typescript/lib/component/list/AbstractCustomList.ts#L918)).

### Delete `AutoCompleteItem` entirely — not exported from the input barrel

`AutoCompleteItem` is not re-exported from [`src/typescript/lib/component/input/index.ts`](../src/typescript/lib/component/input/index.ts) (verified — only `AutoCompleteField` and its options/type aliases are exported) and has no consumer outside `AutoCompleteDropdown`. Delete the file; the row chrome the embedded list uses comes from the shared `.CustomListRow` / `.CustomListRow:hover` / `.CustomListRow.focused` rules in `AbstractCustomList`.

The `--ts-ui-autocomplete-item-hover-bg` token in `AutoCompleteItem.ts:55` becomes orphaned at the source level but stays valid as a published theme token; the row's actual chrome reads from `--ts-ui-list-row-hover-bg` / `--ts-ui-indicator-selection`. Aliasing or unifying the tokens is a follow-up — out of scope here.

### Visual change: row height 24 → 22

[`AutoCompleteItem.HEIGHT = 24`](../src/typescript/lib/component/input/AutoCompleteItem.ts#L28). The embedded list will render rows at the shared `ROW_HEIGHT_PX = 22` from [AbstractCustomList.ts:37](../src/typescript/lib/component/list/AbstractCustomList.ts#L37). Adopt 22 — the rest of the framework's row stack (`List`, `MultiSelectList`, `ComboBoxDropdown`, `MenuItem`) is already on 22. Acceptable UX consolidation.

### Suppress the inner List's `:focus::after` ring inside the dropdown

Mirror the recipe from ComboBox ([ComboBox.ts:326-336](../src/typescript/lib/component/input/ComboBox.ts#L326-L336)): a module-level `StyleRule` `.AutoCompleteDropdown .List:focus::after { content: none }` suppresses the heavy 2-px focus ring on the embedded list. Belt-and-braces — the list never actually takes focus under host-forwarded keys, but a defensive rule keeps the chrome single-surface if any future code path programmatically focuses the list.

---

## Public API (TypeScript Signatures)

### `AbstractCustomList` (additions)

```typescript
abstract class AbstractCustomList<TValue, TOptions extends AbstractCustomListOptions> {
    /** When true (default), keyboard navigation commits the focused row. */
    protected _selectFollowsFocus: boolean;

    /**
     * Toggles whether keyboard navigation (ArrowUp/Down/Home/End/Page*)
     * commits the focused row as the selection. When false, the focus
     * highlight moves but the selection set is untouched and the change
     * event does not fire. Enter / Space / click still commit.
     */
    setSelectFollowsFocus(value: boolean): this;

    /** The current keyboard-focus index, or -1 when no row holds focus. */
    getFocusedIndex(): number;

    /** The DOM element id of the focused row, or null. */
    getFocusedRowId(): string | null;
}
```

`moveFocus` is rewritten to consult `_selectFollowsFocus`:

```typescript
protected moveFocus(idx: number, ctrl: boolean, shift: boolean): void {
    this._focusedIndex = idx;

    const commit = !ctrl && this._selectFollowsFocus;
    if (commit) {
        this.reduceSelection(idx, { ctrl: false, shift });
    }

    this.refreshRowVisualState();
    this.updateActiveDescendant();
    this.scrollIndexIntoView(idx);

    if (commit) {
        this.notifyUserChange();
    }
}
```

### `AutoCompleteDropdown` (rewritten — same external surface as observed by `AutoCompleteField`)

```typescript
class AutoCompleteDropdown extends AnimatedDropdown<AutoCompleteDropdownOptions> {
    constructor(onSelect: (value: string) => void, onHide: () => void, options?: AutoCompleteDropdownOptions);

    show(anchorEl: HTMLElement, suggestions: string[]): this;
    hide(): this;

    /** Forward a keystroke from the host TextField into the inner list. */
    handleKey(e: KeyboardEvent): boolean;

    /** Element id of the currently focused row, for aria-activedescendant. */
    getFocusedRowId(): string | null;

    /** Test seam — direct list access. */
    getList(): List;
}
```

Removed methods: `setMaxItems`, `getMaxItems` (the cap lives on `AutoCompleteField.maxSuggestions` which pre-truncates via `.slice(0, maxSuggestions)` in [`querySuggestions`](../src/typescript/lib/component/input/AutoCompleteField.ts#L516); the dropdown-level field is unused beyond `_options`), `highlightNext`, `highlightPrev`, `selectHighlighted`, `getHighlightedValue`, `getHighlightedId`, `moveTo`, `updatePool`.

The `AutoCompleteDropdownOptions` interface loses `maxItems` (it was never wired to anything beyond `_options`).

### `AutoCompleteField` (no public API change)

`AutoCompleteField.onKeyDown` is rewritten to forward navigation / commit keys through `dropdown.handleKey`; everything else (`addSelectListener`, `setSuggestions`, `setStore`, `setMinChars`, `setDebounceMs`, `setMaxSuggestions`, `setMatchMode`, `setPlaceholder`) is unchanged.

---

## Internal Structure

After the refactor, `AutoCompleteDropdown` shrinks to roughly:

```typescript
class AutoCompleteDropdown extends AnimatedDropdown<AutoCompleteDropdownOptions> {
    private readonly _list: List;
    private readonly _onSelect: (value: string) => void;
    private readonly _onHide: () => void;
    private readonly _onViewportMouseDown: (e: MouseEvent) => void;

    constructor(onSelect: (value: string) => void, onHide: () => void, options?: AutoCompleteDropdownOptions) {
        super(options, _defaultAutoCompleteDropdownOptions);

        this._onSelect = onSelect;
        this._onHide   = onHide;

        // Mirror ComboBoxDropdown: the dropdown root carries the listbox role
        // implicitly via the inner List's own `role=listbox`. Do not duplicate
        // it on the wrapper — nested listboxes break AT enumeration.
        this.setContain("layout");
        this.setLayoutManager(new Fit());

        // Same focus-aware list shape as ComboBoxDropdown — strip chrome
        // (the dropdown root owns it), suppress focus-on-row-click, and
        // disable selection-follows-focus so ArrowUp/Down only moves the
        // highlight.
        this._list = new List();
        this._list.setBorder("none");
        this._list.setBorderRadius("0");
        this._list.setFocusOnRowClick(false);
        this._list.setSelectFollowsFocus(false);
        this.addComponent(this._list);

        this._list.addActionListener(() => {
            const value = this._list.getValue();
            if (value) {
                this._onSelect(value);
            }
        });

        this._onViewportMouseDown = (e: MouseEvent) => {
            if (!this.getElement()?.contains(e.target as Node)) {
                this.hide();
            }
        };
    }

    show(anchorEl: HTMLElement, suggestions: string[]): this {
        this.getElement(true);

        this.pauseLayout();
        this._list.setItemsArray(suggestions.map(s => ({ key: s, label: s })));
        this.resumeLayout();

        const perim   = this.getPerimiterSize();
        const chromeH = perim.top + perim.bottom;
        const rect    = anchorEl.getBoundingClientRect();

        this.setWidth(rect.width);
        this.setHeight(suggestions.length * ROW_HEIGHT_PX + chromeH);
        this.placeAnchored(rect);
        this.showAnimated();
        this.doLayout();

        Event.addViewportListener(this, "mousedown", this._onViewportMouseDown);

        return this;
    }

    handleKey(e: KeyboardEvent): boolean {
        return this._list.handleKey(e);
    }

    getFocusedRowId(): string | null {
        return this._list.getFocusedRowId();
    }

    // hide, onHideComplete, getList … unchanged shape.
}
```

`AutoCompleteField.onKeyDown` collapses to roughly:

```typescript
private onKeyDown(e: KeyboardEvent): void {
    if (this._dropdown.isOpen()) {
        // Allow-list — printable keys must fall through to the TextField's
        // `input` handler (querySuggestions) without entering the list's
        // type-ahead buffer.
        const forward = e.key === "ArrowDown" || e.key === "ArrowUp"
                     || e.key === "Enter"     || e.key === "Tab";

        if (forward && this._dropdown.handleKey(e)) {
            e.preventDefault();
            this.updateActiveDescendant();
            return;
        }
    }

    switch (e.key) {
        case "ArrowDown":
            // Dropdown was closed — fire the query.
            e.preventDefault();
            this.querySuggestions(this.getValue());
            break;
        case "Escape":
            this._dropdown.hide();
            this._textField.focus();
            break;
        case "Tab":
            this._dropdown.hide();
            break;
    }
}
```

The Enter case disappears — Enter on the open dropdown is forwarded to `handleKey`, which routes through the list's `commitFocusedRow` → `reduceSelection` → `notifyUserChange` → fires `change` → the constructor-registered `addActionListener` → `onSuggestionSelected`. Same commit path as click.

Note on Tab: `handleKey` does not handle Tab (it's not in the navigable set and the `Enter || " "` branch doesn't match), so the forward returns false and Tab still falls through to the existing `hide()` branch.

---

## Ordered Implementation Steps

### Step 1 — Add `setSelectFollowsFocus`, `getFocusedIndex`, `getFocusedRowId` to `AbstractCustomList`

[`src/typescript/lib/component/list/AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts) — add the `_selectFollowsFocus: boolean = true` protected field next to `_focusOnRowClick` ([AbstractCustomList.ts:416](../src/typescript/lib/component/list/AbstractCustomList.ts#L416)), the public setter, and the two getters. Rewrite [`moveFocus`](../src/typescript/lib/component/list/AbstractCustomList.ts#L1151) to gate `reduceSelection` + `notifyUserChange` on `_selectFollowsFocus`. JSDoc the new methods; cross-link with markdown form to `AutoCompleteDropdown` per `_shared/docs-conventions.md`.

Verification: `npx tsc --noEmit` 0 errors. Existing `List` / `MultiSelectList` / `ComboBoxDropdown` smoke paths unchanged (their default `_selectFollowsFocus = true` preserves current behaviour).

### Step 2 — Rewrite `AutoCompleteDropdown` to host a `List`

[`src/typescript/lib/component/input/AutoCompleteDropdown.ts`](../src/typescript/lib/component/input/AutoCompleteDropdown.ts) — replace the body per **Internal Structure**. `_pool: AutoCompleteItem[]` becomes `_list: List`. `show` uses `placeAnchored` from `AnimatedDropdown` ([AnimatedDropdown.ts:370](../src/typescript/lib/core/AnimatedDropdown.ts#L370)) instead of computing `y = rect.bottom` vs `rect.top` manually. Imports lose `VBox` (the list's inner panel owns the layout) and `AutoCompleteItem` (deleted in step 4); gain `Fit` and `List` and `CustomListItem` (typed item) and the `ROW_HEIGHT_PX` constant (re-import or recompute).

The `_highlightedIndex` field disappears; the list owns `_focusedIndex` instead.

Drop the `this.getAria().setRole("listbox")` line — the embedded list already exposes the listbox role on itself, and nesting it on the wrapper breaks AT enumeration (same fix the ComboBox refactor made, see [ComboBox.ts:118-122](../src/typescript/lib/component/input/ComboBox.ts#L118-L122)).

### Step 3 — Add the dropdown's focus-ring suppression style rule

In the same file, add a module-level IIFE that registers:

```typescript
new StyleRule({
    scope:  "selector",
    name:   ".AutoCompleteDropdown .List:focus::after",
    styles: { content: "none" },
});
```

Mirrors the `.ComboBoxDropdown .List:focus::after { content: none; }` rule at [ComboBox.ts:330-336](../src/typescript/lib/component/input/ComboBox.ts#L330-L336). Belt-and-braces — the list never takes focus under host-forwarded keys, but a future code path that does won't paint a stripe inside the dropdown.

### Step 4 — Delete `AutoCompleteItem.ts`

Remove the file. Confirm no remaining imports anywhere: `grep -rn 'AutoCompleteItem' src/` should match nothing.

### Step 5 — Rewrite `AutoCompleteField.onKeyDown` to forward via `dropdown.handleKey`

[`src/typescript/lib/component/input/AutoCompleteField.ts`](../src/typescript/lib/component/input/AutoCompleteField.ts#L419-L459) — replace the switch with the host-forward shape from **Internal Structure**. Important: the forward must be guarded by an allow-list (`ArrowDown` / `ArrowUp` / `Enter` / `Tab`) so printable characters fall through to the TextField's `input` handler. Without the allow-list, type-ahead-eligible single characters would be consumed by the list and the TextField's `input` event would still fire — double-effect on every keystroke.

Update [`updateActiveDescendant`](../src/typescript/lib/component/input/AutoCompleteField.ts#L590) to read `dropdown.getFocusedRowId()` instead of `dropdown.getHighlightedId()`.

### Step 6 — Drop `maxItems` from `AutoCompleteDropdownOptions`

`maxItems` on the dropdown was never wired beyond `_options` — the cap lives on `AutoCompleteField.maxSuggestions` (pre-truncated via `.slice(0, maxSuggestions)` at [AutoCompleteField.ts:526](../src/typescript/lib/component/input/AutoCompleteField.ts#L526)). Delete `setMaxItems`, `getMaxItems`, and the `maxItems` interface field. Update the `applyOptions` dispatch to drop the corresponding line.

### Step 7 — Smoke-test the autocomplete demo + cell-editor variants

- `MiscPanel` autocomplete demo screen ([MiscPanel.ts:594](../src/typescript/MiscPanel.ts#L594)): open the field, type, confirm suggestions appear; ArrowDown/Up highlights without writing to the input; Enter commits; Escape closes; click commits.
- Store-backed autocomplete (if exercised in any demo): bind a store, type, confirm filtered suggestions appear and refresh on store events.
- Cell-editor variant: as of this writing there is no `AutoCompleteCellEditor` (`find src -name '*CellEditor*'` only surfaces `TextInputCellEditor` and the pool/base classes); skip this step until one exists. The host-forwarded keystroke pattern is already validated by ComboBox in its cell-editor variant.

### Step 8 — Export bookkeeping

`AutoCompleteItem` is not re-exported from the per-subpath barrel (`src/typescript/lib/component/input/index.ts` — verified: only `AutoCompleteField` + options/types are exported), so deleting it is API-safe. Verify with `grep -rn 'AutoCompleteItem' src/typescript/lib/component/input/index.ts` — expect zero matches. No public surface change.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` — add `_selectFollowsFocus`, `setSelectFollowsFocus`, `getFocusedIndex`, `getFocusedRowId`; gate `moveFocus`'s commit on the flag. |
| Modify | `src/typescript/lib/component/input/AutoCompleteDropdown.ts` — rewrite to host a `List`; drop `maxItems`; drop the redundant `listbox` role on the wrapper; add the focus-ring suppression style rule. |
| Modify | `src/typescript/lib/component/input/AutoCompleteField.ts` — collapse `onKeyDown` to forward an allow-list of keys via `dropdown.handleKey`; update `updateActiveDescendant` to read `dropdown.getFocusedRowId()`. |
| Delete | `src/typescript/lib/component/input/AutoCompleteItem.ts` — replaced by `CustomListRow`. |

No new files. No barrel changes (`AutoCompleteItem` was internal).

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — 0 errors (modulo the documented baseline noise around `@types/node`).
- **Grep invariants:**
  - `grep -rn 'AutoCompleteItem' src/` → 0 matches after the change.
  - `grep -rn '_pool\b\|_highlightedIndex' src/typescript/lib/component/input/AutoCompleteDropdown.ts` → 0 matches.
  - `grep -rn 'AutoCompleteItem' docs/api/component/input/` → 0 matches after `npm run docs:api` regenerates the API output (the page is auto-deleted when the source file is removed).
- **Docs build:** `npm run docs:build` — 0 errors, 0 new link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Manual smoke test:** the `MiscPanel` autocomplete demo screen ([MiscPanel.ts:594](../src/typescript/MiscPanel.ts#L594)) — type, navigate, commit, escape, theme toggle.

---

## Documentation Impact

- `AutoCompleteDropdown` is exported from `~/component/input/AutoCompleteDropdown.js` but **not** re-exported from `src/typescript/lib/component/input/index.ts`; TypeDoc still surfaces it under `docs/api/component/input/classes/AutoCompleteDropdown.md` because it's reachable via re-export from `AutoCompleteField`. The shape change (drop `maxItems`, drop the `highlight*` family) regenerates the API page automatically — no curated doc edit needed beyond confirming the page builds clean.
- `AutoCompleteItem`'s API page (`docs/api/component/input/classes/AutoCompleteItem.md`) is removed automatically when its source file is deleted. Confirm post-build.
- [`docs/components/AutoCompleteField.md`](../docs/components/AutoCompleteField.md) describes the field's API surface and does not name `AutoCompleteItem`; no edit required.
- `AbstractCustomList` is not exported from the list barrel (it's abstract); the new `setSelectFollowsFocus` / `getFocusedIndex` / `getFocusedRowId` methods reach the API output via inheritance into `List` and `MultiSelectList`. TypeDoc renders inherited methods on the concrete classes' pages ([docs/api/component/list/classes/List.md](../docs/api/component/list/classes/List.md), [docs/api/component/list/classes/MultiSelectList.md](../docs/api/component/list/classes/MultiSelectList.md)).
- Cross-bucket JSDoc: in `AbstractCustomList`'s new method docs, link to [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField) via markdown form (different subpath) per `_shared/docs-conventions.md`.

---

## Potential Challenges

- **Type-ahead double-fire if the forward isn't gated.** `handleKey` consumes printable single characters and feeds the list's type-ahead buffer ([AbstractCustomList.ts:1038-1042](../src/typescript/lib/component/list/AbstractCustomList.ts#L1038-L1042)). The TextField's `input` event also fires on every keystroke and drives `querySuggestions`. Mitigation: the rewritten `onKeyDown` only forwards an allow-list of navigation / commit keys (`ArrowDown`, `ArrowUp`, `Enter`, `Tab`) — printable characters bypass `handleKey` entirely.
- **`onBlur`'s 150 ms timeout race.** [`AutoCompleteField.onBlur`](../src/typescript/lib/component/input/AutoCompleteField.ts#L473-L484) currently waits 150 ms before hiding so a click on a row can land first. After the refactor, `CustomListRow.onPointerDown` already calls `preventDefault` to suppress focus loss, and the host's `setFocusOnRowClick(false)` keeps the list from grabbing focus on row click. The timeout becomes partly redundant — keep it for safety on the first pass; consider removing in a follow-up.
- **`maxItems` removal is observable** if a consumer constructed the dropdown directly with `maxItems` (which is not currently possible via the field options bag — only via direct `new AutoCompleteDropdown({ maxItems })`). The internal usage in `AutoCompleteField` does not pass it, and the option was never wired beyond `_options`. Safe to drop; flagged for the audit.
- **`AbstractCustomList.handleKey` skips Escape on purpose** ([AbstractCustomList.ts:1021](../src/typescript/lib/component/list/AbstractCustomList.ts#L1021)) so the host can close the wrapping overlay. The new `onKeyDown` switch must still own the Escape / Tab branches — verified in **Internal Structure**.
- **Store-backed suggestions with `displayField` ≠ identity.** Today's `querySuggestions` reads `r.get(displayField)` and pushes that string. The new `setItemsArray` flow uses `{ key: s, label: s }` (key === label), which means `list.getValue()` returns the display string. If a future caller wants the underlying record's id as the value, the autocomplete would need a separate `valueField` axis — out of scope; same as today.
- **`getFocusedRowId` returning null pre-mount.** Rows in the pool only have DOM ids once they've been instantiated (the `Component.init` path generates ids lazily). The list's existing `updateActiveDescendant` reads `_rowPool[i].getId()` and is called from `syncRows` after `addComponent`. Mirror this; `getFocusedRowId` returns null when the pool is empty or the focused row hasn't been instantiated.
- **Row-height drop 24 → 22.** Visible UX change — a fraction of a row on multi-row dropdowns. Acceptable given the rest of the framework uses 22. Flag in the audit but no special mitigation.

---

## Critical Files

- [`src/typescript/lib/component/list/AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts) — owns the row pool, keyboard model, `moveFocus`, and `handleKey`. The only file gaining new public surface (`setSelectFollowsFocus`, `getFocusedIndex`, `getFocusedRowId`).
- [`src/typescript/lib/component/list/List.ts`](../src/typescript/lib/component/list/List.ts) — concrete single-select reducer; `setItemsArray` is already public here (added by `combobox-list-dropdown`).
- [`src/typescript/lib/component/input/AutoCompleteDropdown.ts`](../src/typescript/lib/component/input/AutoCompleteDropdown.ts) — the file under modification.
- [`src/typescript/lib/component/input/AutoCompleteField.ts`](../src/typescript/lib/component/input/AutoCompleteField.ts) — the file under modification (`onKeyDown`, `updateActiveDescendant`).
- [`src/typescript/lib/component/input/AutoCompleteItem.ts`](../src/typescript/lib/component/input/AutoCompleteItem.ts) — the file under deletion. Read to confirm no hidden contracts before deleting.
- [`src/typescript/lib/component/input/ComboBox.ts`](../src/typescript/lib/component/input/ComboBox.ts) — the canonical reference for the host-forwarded keystroke pattern (`ComboBoxDropdown.handleKey` at [line 167](../src/typescript/lib/component/input/ComboBox.ts#L167), `_list.setFocusOnRowClick(false)` at [line 136](../src/typescript/lib/component/input/ComboBox.ts#L136), and the focus-ring suppression style rule at [lines 330-336](../src/typescript/lib/component/input/ComboBox.ts#L330-L336)).
- [`src/typescript/lib/core/AnimatedDropdown.ts`](../src/typescript/lib/core/AnimatedDropdown.ts) — read the `placeAnchored` helper at [line 370](../src/typescript/lib/core/AnimatedDropdown.ts#L370) and the pointer-down / layer-stack contracts; the new dropdown rides them unchanged.
- [`plans/implemented/combobox-list-dropdown.md`](implemented/combobox-list-dropdown.md) — the pattern this plan mirrors. Required reading.

---

## Non-Goals

- **Replace `--ts-ui-autocomplete-item-*` tokens with `--ts-ui-list-row-*`.** The chrome the embedded list renders uses the list-row tokens already, but the autocomplete-bg / autocomplete-item-hover-bg tokens stay published for theme consumers. A separate plan can unify.
- **Replace the `onBlur` 150 ms timeout.** Same as today — possible follow-up once `pointerdown.preventDefault` on `CustomListRow` is confirmed sufficient.
- **Add a `valueField` axis to `AutoCompleteField` for store-backed suggestions.** Out of scope; same shape as today.
- **Migrate `Menu` row rendering to `List`.** Confirmed not a fit in `combobox-list-dropdown.md`; same verdict here.
- **Migrate the picker dropdowns.** Same verdict as `combobox-list-dropdown.md`.
- **Touch the autocomplete `:focus-within::after` pseudo on `AutoCompleteField`** ([AutoCompleteField.ts:21-36](../src/typescript/lib/component/input/AutoCompleteField.ts#L21-L36)). That's the host composite's focus ring, unrelated to the dropdown's row pool.
- **Adopt `ComboBox`-style cross-cell state delegation (the sibling [`combobox-state-delegation.md`](combobox-state-delegation.md) plan).** That plan moves ComboBox's `_items` / `_selectedIndex` / `_value` into the list; the equivalent here would be deleting `AutoCompleteField._options.suggestions` and reading from the list. Defer — the autocomplete state surface is already minimal (one string array cached on `_options`), and the list only exists while the dropdown is open.
