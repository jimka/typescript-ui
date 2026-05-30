---
touches-shared:
  - src/typescript/lib/component/list/AbstractCustomList.ts
  - src/typescript/lib/component/list/List.ts
  - src/typescript/lib/component/list/MultiSelectList.ts
  - src/typescript/lib/component/input/ComboBox.ts
  - src/typescript/lib/component/input/index.ts
  - docs/.vitepress/config.mts
---

# Keyed List Items & Option Removal — Implementation Plan

## Overview

The custom-list family ([`List`](../src/typescript/lib/component/list/List.ts), [`MultiSelectList`](../src/typescript/lib/component/list/MultiSelectList.ts), and the [`ComboBox`](../src/typescript/lib/component/input/ComboBox.ts) that embeds a `List`) currently only accepts **plain string** items, which the base [`AbstractCustomList.setItems`](../src/typescript/lib/component/list/AbstractCustomList.ts#L578) / [`addItem`](../src/typescript/lib/component/list/AbstractCustomList.ts#L641) auto-key by stringified index (`{ key: String(i), label }`). Callers who want explicit, stable keys without standing up a `Store` have no entry point — only the internal protected [`setItemsArray(Array<CustomListItem>)`](../src/typescript/lib/component/list/AbstractCustomList.ts#L619) takes pre-formed `{ key, label }` pairs, and only `List` promotes it to public ([List.ts:90](../src/typescript/lib/component/list/List.ts#L90)).

This plan widens `addItem` and `setItems` on the base to accept a `string` **or** a `{ key, label }` (`CustomListItem`) object and surfaces the widened signatures on the `ComboBox` / `List` / `MultiSelect` public APIs. The widened `setItems` is the single public way to pass an array (including keyed `{ key, label }` pairs) — `setItemsArray` stays a **protected internal primitive** on the base that the widened `setItems` delegates to, and no new public `setItemsArray` is added to `ComboBox` (it would duplicate the widened `setItems`). As a coupled cleanup it deletes the orphaned [`Option`](../src/typescript/lib/component/input/Option.ts) class — verified zero non-trivial consumers; ComboBox moved off `Option` onto `AnimatedDropdown` + embedded `List` in a prior rewrite, and `Option`'s own `key`/`value`/`label` field shape is *distinct* from the list's `{ key, label }`, so it cannot be reused as the item type.

`CustomListItem` is already re-exported from the list barrel ([component/list/index.ts:7](../src/typescript/lib/component/list/index.ts#L7)), so consumers can already name the `{ key, label }` type — no new export needed there.

---

## Architecture Decisions

### Union signatures and the string-vs-object discriminator

Widen both base methods to a single new exported item-union type alias so the three public surfaces all spell the same thing:

```typescript
export type CustomListItemSpec = String | CustomListItem;
```

- `setItems(items: CustomListItemSpec | Array<CustomListItemSpec>)`
- `addItem(item: CustomListItemSpec)`

The conversion loop discriminates with `typeof item === "string"`. The existing param type on the codebase is the boxed `String` (not `string`) — kept for backward signature-compatibility — but `typeof` on a runtime string primitive returns `"string"` regardless, and TypeScript narrows the union correctly: the `"string"` branch leaves `CustomListItem`, the `else` branch is the object. This matches the established pattern already used across the codebase (`typeof textOrOptions === "string"` in [Button.ts:226](../src/typescript/lib/component/button/Button.ts#L226), [Popover.ts:397](../src/typescript/lib/core/Popover.ts#L397)).

### Key-collision contract: only string entries get auto-index keys

The hazard: a mixed array `["A", { key: "0", label: "B" }]` would, under a naive "auto-key everything by position" scheme, produce two items both keyed `"0"`. **Chosen contract:** *string entries are auto-keyed by their array index; object entries keep their caller-supplied key verbatim.* The auto-index is the entry's position in the array (the loop index `i`), unchanged from today. The caller owns uniqueness across explicit keys and across any collision between an explicit key and an auto-index — this is documented in the JSDoc on `setItems` / `addItem`.

Rationale: (a) it is the *least surprising* rule — a plain string behaves exactly as it does today, and an explicit key is honoured exactly as written; (b) any "renumber to avoid collisions" scheme would silently rewrite a caller's chosen key, defeating the entire feature; (c) `getValue` / `setValue` resolve by `findIndex(item => item.key === value)` and return the **first** match, so a duplicate key is merely addressed by the lowest matching row — a tolerable, documented consequence of caller misuse, not a crash. `addItem` keeps using `this._items.length` as the auto-index for a pushed string (its current behaviour), so appending a string after explicit-keyed items still index-keys by final position.

### Backward compatibility — the all-strings path is byte-for-byte unchanged

For a pure-string array every entry takes the `typeof === "string"` branch and produces `{ key: String(i), label }` exactly as [the current loop](../src/typescript/lib/component/list/AbstractCustomList.ts#L586-L588) does. `addItem("X")` on an all-string list still pushes `{ key: String(this._items.length), label: "X" }`. Therefore the index-keyed `getValue()` behaviour that the `TabDemoPanel` width-mode combo and `MiscPanel` rely on is preserved with zero behavioural change. The only new code path is reached when a caller passes an object — existing callers never do.

### `setItemsArray` stays a protected internal primitive; `setItems` is the single public array entry point

`setItemsArray(Array<CustomListItem>)` already exists protected on the base and public on `List`. It remains the **protected internal primitive** that pushes pre-formed `{ key, label }` pairs without auto-keying. The widened `setItems` discriminates string-vs-object, builds the `CustomListItem[]`, and delegates to this protected `setItemsArray` (or the equivalent internal push path); [`ComboBoxDropdown.showAt`](../src/typescript/lib/component/input/ComboBox.ts#L182-L184) continues to call it internally, unchanged, on its already-typed items.

**No new public `setItemsArray` is added to `ComboBox` (or `MultiSelect`).** Per this plan's own collision contract, object entries are never auto-keyed, so `setItems([{ key, label }, …])` is behaviourally identical to a hypothetical `setItemsArray([{ key, label }, …])`. The widened `setItems` therefore fully subsumes a public `setItemsArray`, and exposing both would be two public methods doing the same thing — a violation of the simplicity convention. The single public way to pass an array (including keyed pairs) is the widened `setItems`.

`List` already exposes `setItemsArray` publicly ([List.ts:90](../src/typescript/lib/component/list/List.ts#L90), pre-existing). This plan leaves that untouched — removing it would be an unrelated breaking change — even though it is now functionally redundant with the widened `setItems`. `MultiSelectList` leaves `setItemsArray` protected (no multi-select consumer needs it; the inherited base method is reachable to internal code only) — confirmed by reading the file end to end.

### ComboBox value round-trip once explicit keys exist

`ComboBox.setValue(key)` already delegates to `this._dropdown.getList().setValue(key)`, which does `findIndex(item => item.key === value)` — so once a caller supplies explicit keys, `setValue("admin")` matches the caller's key rather than a stringified index, with **no ComboBox code change**. `_pendingValue` / `reapplyPendingValue` are unaffected: they cache the key the caller wrote and re-apply it after an items load; whether that key is an auto-index `"0"` or an explicit `"admin"` is immaterial to the caching logic. `refreshLabel` / `computeLabel` read `getSelectedIndex()` + `getItems()[idx].label`, which is key-agnostic. `autoSelectFirstIfEmpty` still selects index 0 when nothing is selected — unchanged. The only behavioural shift is the intended one: `getValue()` now returns the caller's key for keyed items instead of the positional index string.

### MultiSelect value round-trip with explicit keys

[`MultiSelectList.getValue`](../src/typescript/lib/component/list/MultiSelectList.ts#L127) maps selected indices to `this._items[i].key`, and [`setValues`](../src/typescript/lib/component/list/MultiSelectList.ts#L85) selects rows whose `item.key` is in the supplied set. Both are already key-based, so explicit keys round-trip correctly through the widened `setItems` / `addItem` with no `MultiSelectList` logic change — only its public `setItems` / `addItem` signatures inherit the widened base types.

### CODE_CONVENTIONS compliance

No new DOM property, no theme token, no new element-per-class. The change is signature-widening plus a deletion. JSDoc on the two widened base methods must document both the string and object forms and the caller-owns-uniqueness contract (per the project's JSDoc requirements). No convention is violated.

---

## Public API (TypeScript Signatures)

New exported union alias on the base (re-exported from the list barrel alongside `CustomListItem`):

```typescript
// AbstractCustomList.ts
export type CustomListItemSpec = String | CustomListItem;
```

`AbstractCustomList` (base — `addItem` and `setItems` move from `protected`/string-only to the widened public form already declared public):

```typescript
setItems(items: CustomListItemSpec | Array<CustomListItemSpec>): this;
addItem(item: CustomListItemSpec): this;
protected setItemsArray(items: Array<CustomListItem>): this;   // unchanged
```

`List` (already promotes `setItemsArray`; inherits widened `setItems` / `addItem`):

```typescript
setItemsArray(items: Array<CustomListItem>): this;             // unchanged
// setItems / addItem inherited with widened signature
```

`MultiSelectList` — no new method; inherits widened `setItems` / `addItem`. `setItemsArray` stays protected (inherited).

`ComboBox` (override the two existing wrappers with widened params; **no** new public `setItemsArray`):

```typescript
setItems(items: CustomListItemSpec | Array<CustomListItemSpec>): this;
addItem(item: CustomListItemSpec): this;
```

`ComboBoxOptions.items` and `AbstractCustomListOptions.items` are left as `String | Array<String>` — widening the *options-bag* field is out of scope (the request targets the imperative `addItem` / `setItems` surface; see Non-Goals).

---

## Internal Structure

Widened base conversion (the only non-trivial new logic), replacing the loop at [AbstractCustomList.ts:584-588](../src/typescript/lib/component/list/AbstractCustomList.ts#L584-L588):

```typescript
this._items = [];
for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    this._items.push(
        typeof entry === "string"
            ? { key: String(i), label: entry }
            : { key: entry.key, label: entry.label },
    );
}
```

`addItem` ([AbstractCustomList.ts:641-649](../src/typescript/lib/component/list/AbstractCustomList.ts#L641)):

```typescript
addItem(item: CustomListItemSpec): this {
    this._items.push(
        typeof item === "string"
            ? { key: String(this._items.length), label: item }
            : { key: item.key, label: item.label },
    );
    // ...existing pauseLayout / syncRows / resumeLayout tail unchanged
}
```

The widened `setItems` builds the `CustomListItem[]` (per the loop above) and delegates to the protected `setItemsArray` internal primitive, which pushes the pre-formed pairs without re-keying. `ComboBox.setItems` / `addItem` keep forwarding to the embedded list's widened methods unchanged; no new ComboBox wrapper is added.

---

## Ordered Implementation Steps

1. **`AbstractCustomList.ts`** — add `export type CustomListItemSpec = String | CustomListItem;` near the `CustomListItem` interface. Widen `setItems` param to `CustomListItemSpec | Array<CustomListItemSpec>` and rewrite its conversion loop per _Internal Structure_, delegating the resulting `CustomListItem[]` to the protected `setItemsArray` (or equivalent internal push path); the `Type.isArray` normalisation at the top stays. Widen `addItem` param to `CustomListItemSpec` and branch its push. Update both JSDoc blocks to document the string + `{ key, label }` forms and the caller-owns-key-uniqueness contract. Leave `setItemsArray` protected and the options-bag `items` field untouched.
2. **`List.ts`** — no signature edit needed (inherits widened base); verify the existing public `setItemsArray` still compiles. Update its class JSDoc only if it claims string-only items (check line 17-29).
3. **`MultiSelectList.ts`** — no method edit; verify it inherits the widened `setItems` / `addItem` and that `setValues` / `getValue` round-trip is untouched. (Read-only confirmation step.)
4. **`ComboBox.ts`** — widen the param types on the existing `setItems` ([:921](../src/typescript/lib/component/input/ComboBox.ts#L921)) and `addItem` ([:935](../src/typescript/lib/component/input/ComboBox.ts#L935)) wrappers to the union; their bodies (`this._dropdown.getList().setItems(items)` etc.) already forward correctly. Do **not** add a public `setItemsArray` — the widened `setItems` is the sole public array entry point. Update the two JSDoc blocks to mention keyed items.
5. **Delete `Option`** — remove `src/typescript/lib/component/input/Option.ts`; remove its two export lines from [`component/input/index.ts:44-45`](../src/typescript/lib/component/input/index.ts#L44-L45).
6. **Regression checkpoint** — `grep -rn "\bOption\b" src/ --include=*.ts | grep -vE "Options|Option [A-Z]\b|RadioButton|Option-backed"` → expect zero matches (the `Option [A-Z]` exclusion covers the unrelated `RadioButton("Option A")` demo labels; `Options` covers every `XxxOptions` interface; `Option-backed` covers the `Component.ts` / `Popover.ts` comments).
7. **Docs** — see _Documentation Impact_.
8. **Verify** — `npx tsc --noEmit` (or the project typecheck) clean; `npm run docs:build` → 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` (union alias + widened `setItems` / `addItem`) |
| Modify | `src/typescript/lib/component/list/List.ts` (JSDoc only, if needed) |
| Modify | `src/typescript/lib/component/list/MultiSelectList.ts` (verify-only; edit only if a signature needs restating) |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` (widen `setItems` / `addItem`) |
| Modify | `src/typescript/lib/component/input/index.ts` (drop `Option` / `OptionOptions` exports) |
| Delete | `src/typescript/lib/component/input/Option.ts` |
| Delete | `docs/components/Option.md` |
| Modify | `docs/.vitepress/config.mts` (remove the `Option` sidebar entry, line 109) |
| Modify | `docs/components/ComboBox.md` (keyed-items example + method-table fix) |
| Modify | `docs/components/index.md` (catalog rows 47 + 81) |
| Modify | `docs/components/ListItem.md` (drop the two `Option` cross-links, lines 28 + 34) |
| Modify | `docs/components/List.md` (optional: note keyed items in the usage section) |
| Modify | `docs/components/MultiSelectList.md` (optional: note keyed items) |

The TypeDoc-generated `docs/api/component/input/classes/Option.md`, `.../interfaces/OptionOptions.md`, and the `docs/.vitepress/dist/` / `cache/` artifacts regenerate (or vanish) on the next `docs:build` — no manual edit.

---

## Verification

- **Typecheck:** project typecheck passes — the union narrows cleanly in both base methods, and the base `setItems` delegates to the protected `setItemsArray` without a re-key.
- **Option removal grep:** the Step-6 grep returns zero hits; a parallel `grep -rln '\bOption\b' docs/components/ docs/.vitepress/config.mts` (excluding `| Option |` table headers) returns zero after the doc edits.
- **Backward-compat smoke:** the `TabDemoPanel` width-mode combo and `MiscPanel` still report index-string keys via `getValue()` for their all-string item lists (no behaviour change) — exercise on the demo app's Tabs and Misc screens.
- **Keyed-items smoke:** a `ComboBox({ }).setItems([{ key: "admin", label: "Admin" }, "Guest"])` returns `"admin"` from `getValue()` after selecting row 0 and `"1"` after selecting row 1 (string auto-indexed at its array position); `MultiSelectList.setItems([...])` + `setValues(["admin"])` round-trips. Add to or exercise via an existing list/combo demo screen.
- **Docs build:** `npm run docs:build` → 0 errors and 0 link warnings (the broken `/components/Option` links in `ListItem.md` and `index.md` would otherwise fail this gate, so it directly validates the doc cleanup).

---

## Documentation Impact

Barrel: `CustomListItem` is already exported from `src/typescript/lib/component/list/index.ts` ([:7](../src/typescript/lib/component/list/index.ts#L7)). Add `CustomListItemSpec` to that barrel as a `type` export so consumers can name the union they pass to `setItems` / `addItem`.

Curated pages:
- **`docs/components/ComboBox.md`** — update the "Static items" section to show the new keyed form, e.g. `ComboBox({ items: [...] })` followed by `combo.setItems([{ key: 'admin', label: 'Admin' }, 'Guest'])`, and note that explicit keys make `getValue()` return the caller's key instead of the positional index. Fix the method-table row `addItem(option)` / "Append a static `Option`." ([:55](../docs/components/ComboBox.md#L55)) to "Append an item (string or `{ key, label }`)." since `Option` no longer exists.
- **`docs/components/List.md`** / **`docs/components/MultiSelectList.md`** — optional one-line note in the usage section that `addItem` / `setItems` also accept `{ key, label }` for explicit keys.
- **`docs/components/ListItem.md`** — remove the two now-dangling `Option` cross-links: the "is not the same as `Option`" note ([:28](../docs/components/ListItem.md#L28)) and the See-also bullet ([:34](../docs/components/ListItem.md#L34)). Reword the note to reference `List` / `ComboBox` item APIs directly instead of `Option`.
- **`docs/components/index.md`** — fix catalog row 47 (drop "list of `Option`" → "list of items or a `Store`") and **delete** the `Option` catalog row 81 entirely.

Removal cleanup for `Option`:
- Delete `docs/components/Option.md`.
- Remove the sidebar entry `{ text: 'Option', link: '/components/Option' }` at [config.mts:109](../docs/.vitepress/config.mts#L109).
- `grep -rln '\bOption\b' docs/components/ docs/.vitepress/config.mts` after edits (excluding `| Option |` table-column headers, which are unrelated) returns zero.

JSDoc cross-bucket: the widened base methods and ComboBox wrappers reference `CustomListItem` only within their own buckets (`{@link CustomListItem}` resolves in the list bucket; ComboBox already links it as `[CustomListItem](/api/component/list/interfaces/CustomListItem)` — keep that markdown-link form, [ComboBox.ts:443](../src/typescript/lib/component/input/ComboBox.ts#L443)).

---

## Potential Challenges

- **Boxed `String` vs primitive `string` in the union** — the existing signatures use boxed `String`; the new object branch uses `CustomListItem`. `typeof entry === "string"` narrows a boxed-`String`-typed value to the primitive branch at runtime correctly, but TypeScript's static narrowing on `String | CustomListItem` puts the non-string remainder (`CustomListItem`) in the `else`. Verified safe against the codebase's existing `typeof … === "string"` guards; if the compiler balks on the boxed type, fall back to `Type.isString(entry)` (already imported via `Type`).
- **Duplicate-key misuse** — a caller mixing an explicit key `"0"` with a string at index 0 produces two rows keyed `"0"`; `findIndex` resolves to the first. Mitigation: documented as caller-owned in the JSDoc; no runtime guard (matches the framework's "don't error on impossible-for-correct-callers scenarios" convention).
- **Docs link gate** — the dangling `/components/Option` links in `ListItem.md` and `index.md` will fail `docs:build` if missed; the Step-8 build is the catch-all.

---

## Critical Files

- [`src/typescript/lib/component/list/AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts) — `CustomListItem` interface (L23), `setItems` (L578), `addItem` (L641), `setItemsArray` (L619), value resolution helpers.
- [`src/typescript/lib/component/list/List.ts`](../src/typescript/lib/component/list/List.ts) — public `setItemsArray` (L90), `getValue` / `setValue` (L103-L125).
- [`src/typescript/lib/component/list/MultiSelectList.ts`](../src/typescript/lib/component/list/MultiSelectList.ts) — `setValues` (L85), `getValue` (L127).
- [`src/typescript/lib/component/input/ComboBox.ts`](../src/typescript/lib/component/input/ComboBox.ts) — `setItems` (L921), `addItem` (L935), `showAt`'s `setItemsArray` use (L184), `reapplyPendingValue` / `autoSelectFirstIfEmpty` / `refreshLabel` / `_pendingValue`.
- [`src/typescript/lib/component/input/Option.ts`](../src/typescript/lib/component/input/Option.ts) — the standalone class to delete (its `key`/`value`/`label` shape differs from `CustomListItem`).
- [`src/typescript/lib/component/list/index.ts`](../src/typescript/lib/component/list/index.ts) / [`component/input/index.ts`](../src/typescript/lib/component/input/index.ts) — barrels.

---

## Non-Goals

- **Widening the options-bag `items` field** (`AbstractCustomListOptions.items` / `ComboBoxOptions.items`) to accept objects — the request scopes the keyed form to the imperative `addItem` / `setItems` surface; the construction-time `items` option stays `String | Array<String>` to avoid touching the super-time cascade dispatch.
- **A public `setItemsArray` on `ComboBox` / `MultiSelect`** — the widened `setItems` subsumes it (object entries are never auto-keyed, so `setItems([{ key, label }, …])` is identical to a `setItemsArray` of the same pairs); two public methods doing the same thing violates the simplicity convention. `setItemsArray` stays a protected internal primitive on the base. `MultiSelectList` leaves it protected/inherited (no multi-select consumer needs it).
- **`List`'s pre-existing public `setItemsArray`** — intentionally left untouched ([List.ts:90](../src/typescript/lib/component/list/List.ts#L90)); it is now functionally redundant with the widened `setItems`, but removing it is an out-of-scope breaking change.
- **Re-keying or de-duplicating explicit keys** — caller owns uniqueness by the chosen contract.
- **Reusing `Option` as the item type** — its `key`/`value`/`label` shape is incompatible with `{ key, label }`; it is deleted, not repurposed.
