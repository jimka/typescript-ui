# AutoCompleteField — Case-Sensitivity Control via `setMatchMode` — Implementation Plan

## Overview

`AutoCompleteField` already filters case-insensitively in both code paths — the static-array branch lowercases both sides (`s.toLowerCase()` / `query.toLowerCase()`) in [`querySuggestions`](../src/typescript/lib/component/input/AutoCompleteField.ts#L447), and the store branch passes `caseSensitive: false` straight to [`store.filterBy`](../src/typescript/lib/component/input/AutoCompleteField.ts#L468). That behaviour is hardcoded: the only knob is `setMatchMode('contains' | 'startsWith')` ([AutoCompleteField.ts:20](../src/typescript/lib/component/input/AutoCompleteField.ts#L20), [AutoCompleteField.ts:289](../src/typescript/lib/component/input/AutoCompleteField.ts#L289)), which controls the position of the match but not its case-folding policy.

This plan keeps the default (case-insensitive `'contains'`) and extends `AutoCompleteMatchMode` with two additional values — `'containsCaseSensitive'` and `'startsWithCaseSensitive'` — so a consumer who *wants* case-sensitive matching can reach it through the existing setter. No parallel `setCaseSensitive` toggle is introduced (per the brief).

Community 33 ([GRAPH_REPORT.md#L234](../graphify-out/GRAPH_REPORT.md#L234)) is the `AutoCompleteField` node and Community 11 ([GRAPH_REPORT.md#L146](../graphify-out/GRAPH_REPORT.md#L146)) is `AutoCompleteDropdown` + `AutoCompleteItem`. Filtering lives entirely in the field — the dropdown is presentation only — so the dropdown classes are untouched.

The store-side primitive ([FilterDescriptor.ts:13-14](../src/typescript/lib/data/FilterDescriptor.ts#L13)) already supports `caseSensitive?: boolean` on `contains` / `startsWith`, so the store branch needs only a value forward, not a new descriptor type.

---

## Architecture Decisions

### Default stays case-insensitive

`'contains'` (already the default per [AutoCompleteField.ts:43](../src/typescript/lib/component/input/AutoCompleteField.ts#L43)) keeps lowercase-folding on both sides. This is what most apps expect from a typeahead field, matches the behaviour shipped in [`plans/implemented/autocomplete.md`](implemented/autocomplete.md), and means no consumer is broken by this change.

### Extend `setMatchMode` rather than add `setCaseSensitive`

A second axis (position × case-sensitivity) could justify two setters, but the cartesian product is only four values and the existing `AutoCompleteMatchMode` union is the natural place to spell them out. A separate `setCaseSensitive` setter would force two-call configuration for every consumer, and would leave a question about which combination is forbidden (none should be). One setter, four union members, one option field — fewer moving parts.

The new union becomes:

```typescript
type AutoCompleteMatchMode =
    | 'contains'
    | 'startsWith'
    | 'containsCaseSensitive'
    | 'startsWithCaseSensitive';
```

Rejected alternatives:
- `'contains' | 'startsWith'` plus a second `caseSensitive: boolean` option field — violates the "single setter" requirement in the brief.
- `{ position: ..., caseSensitive: ... }` object value — heavier than necessary for a four-value enum and unusual versus the rest of the framework's enum-style modes.

### Case-folding stays in the field, not the dropdown

The field already owns the filter logic (`matches()` + `querySuggestions`); the dropdown receives a finished string list. Keeping case-folding in the field preserves that contract — the dropdown does not learn about modes.

### Store branch forwards `caseSensitive` to the descriptor

[FilterDescriptor.ts:52-61](../src/typescript/lib/data/FilterDescriptor.ts#L52) already branches on `descriptor.caseSensitive`. The field just needs to compute `caseSensitive: matchMode.endsWith('CaseSensitive')` and pass it through. No new descriptor variant.

### `matches()` becomes mode-aware, not just position-aware

Today `matches()` takes pre-lowercased strings ([AutoCompleteField.ts:431](../src/typescript/lib/component/input/AutoCompleteField.ts#L431)) and branches only on position. After the change, the lower-casing moves *inside* the function (or its caller is split), so the function decides both position and case-folding. The simplest shape: `matches(candidate, query)` takes raw strings and consults `this._options.matchMode ?? 'contains'` to decide both axes. The redundant `lower` parameter goes away.

---

## Public API (TypeScript Signatures)

### `AutoCompleteMatchMode`

```typescript
/**
 * Controls how typed input is matched against suggestion strings.
 *
 * - `'contains'`                 — substring match, case-insensitive (default).
 * - `'startsWith'`               — prefix match, case-insensitive.
 * - `'containsCaseSensitive'`    — substring match, case-sensitive.
 * - `'startsWithCaseSensitive'`  — prefix match, case-sensitive.
 */
export type AutoCompleteMatchMode =
    | 'contains'
    | 'startsWith'
    | 'containsCaseSensitive'
    | 'startsWithCaseSensitive';
```

### `AutoCompleteFieldOptions`

No structural change — `matchMode?: AutoCompleteMatchMode` already exists at [AutoCompleteField.ts:43](../src/typescript/lib/component/input/AutoCompleteField.ts#L43). Its inferred set expands automatically when the union widens. Update the JSDoc default note to spell out "(case-insensitive)" so the new variants read in context.

### `AutoCompleteField`

```typescript
setMatchMode(mode: AutoCompleteMatchMode): this;
```

Signature unchanged; only the accepted values expand. The options bag remains the cache (`this._options.matchMode`), per the [ARCHITECTURE.md "options bag is the cache"](../ARCHITECTURE.md#three-non-negotiable-rules-for-every-dom-write) rule — no private backing field is needed because no normalisation occurs.

---

## Internal Structure

### Reshaped `matches()`

```typescript
private matches(candidate: string, query: string): boolean {
    const mode = this._options.matchMode ?? 'contains';

    const caseSensitive = mode === 'containsCaseSensitive'
                       || mode === 'startsWithCaseSensitive';
    const startsWith    = mode === 'startsWith'
                       || mode === 'startsWithCaseSensitive';

    const haystack = caseSensitive ? candidate : candidate.toLowerCase();
    const needle   = caseSensitive ? query     : query.toLowerCase();

    return startsWith ? haystack.startsWith(needle) : haystack.includes(needle);
}
```

The caller in `querySuggestions` collapses from two-step pre-lowercase to a single direct call:

```typescript
const filtered = suggestions
    .filter(s => this.matches(s, query))
    .slice(0, maxSuggestions);
```

### Store branch

```typescript
const caseSensitive = matchMode === 'containsCaseSensitive'
                   || matchMode === 'startsWithCaseSensitive';
const filterType    = (matchMode === 'startsWith' || matchMode === 'startsWithCaseSensitive')
                    ? 'startsWith'
                    : 'contains';

store.filterBy({
    type: filterType,
    field: displayField,
    value: query,
    caseSensitive,
});
```

---

## Ordered Implementation Steps

1. **Widen the `AutoCompleteMatchMode` union** in [AutoCompleteField.ts:20](../src/typescript/lib/component/input/AutoCompleteField.ts#L20) to four members. Update its JSDoc to describe each variant and call out that `'contains'` (the default) is case-insensitive. Verify: `npm run typecheck`.

2. **Update `AutoCompleteFieldOptions.matchMode` JSDoc** at [AutoCompleteField.ts:43](../src/typescript/lib/component/input/AutoCompleteField.ts#L43) — clarify "Default: `'contains'` (case-insensitive)". No structural change.

3. **Rewrite `matches()`** at [AutoCompleteField.ts:431](../src/typescript/lib/component/input/AutoCompleteField.ts#L431). Take raw `candidate`, `query`; compute `caseSensitive` and `startsWith` flags from `this._options.matchMode`; lowercase only when needed; return the appropriate `includes` / `startsWith` result. Update the JSDoc — drop the "Both strings must already be lowercased" line.

4. **Simplify the static-array call site** in `querySuggestions` at [AutoCompleteField.ts:454-462](../src/typescript/lib/component/input/AutoCompleteField.ts#L454). Drop the `lower` local; call `this.matches(s, query)` directly.

5. **Forward `caseSensitive` to the store filter** in `querySuggestions` at [AutoCompleteField.ts:467-474](../src/typescript/lib/component/input/AutoCompleteField.ts#L467). Compute `caseSensitive` and `filterType` from `matchMode`; replace the hardcoded `caseSensitive: false` and conditional `type` with the computed values. Verify: `grep -n "caseSensitive: false" src/typescript/lib/component/input/AutoCompleteField.ts` — expect zero matches.

6. **Update `setMatchMode` JSDoc** at [AutoCompleteField.ts:284-289](../src/typescript/lib/component/input/AutoCompleteField.ts#L284). Describe all four modes; keep the body unchanged (it just writes `this._options.matchMode = mode`).

7. **Add a demo screen** exercising the new modes (see Verification). One panel, four `AutoCompleteField`s using the same `['Apple', 'apricot', 'Banana', 'BANANA', 'cherry']` suggestion list, each with a different `matchMode`. Typing `"a"` and `"A"` should produce visibly different result sets across the four fields.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/input/AutoCompleteField.ts` |
| Modify | one existing demo file under `src/typescript/demo/` (or create `src/typescript/demo/AutoCompleteCaseDemo.ts` if no existing autocomplete demo screen) |

No changes to `AutoCompleteDropdown.ts`, `AutoCompleteItem.ts`, `FilterDescriptor.ts`, `Theme.ts`, or any barrel — the union widens within the existing public type, and the options bag field already exists.

---

## Verification

- `npm run typecheck` passes.
- `npm run docs:build` reports 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).
- `grep -n "caseSensitive: false" src/typescript/lib/component/input/AutoCompleteField.ts` returns nothing — the value is now computed.
- `grep -n "toLowerCase" src/typescript/lib/component/input/AutoCompleteField.ts` returns matches only inside `matches()` (the static branch's pre-lowercase is gone).
- Manual demo: with `suggestions: ['Apple', 'apricot', 'Banana', 'BANANA', 'cherry']`:
  - `matchMode: 'contains'` (default) — typing `"a"` matches all five; typing `"A"` matches all five.
  - `matchMode: 'startsWith'` — typing `"a"` matches `Apple`, `apricot`; typing `"A"` matches the same two.
  - `matchMode: 'containsCaseSensitive'` — typing `"a"` matches `apricot`, `Banana`; typing `"A"` matches `Apple`, `BANANA`.
  - `matchMode: 'startsWithCaseSensitive'` — typing `"a"` matches `apricot`; typing `"A"` matches `Apple`.
- Store-backed verification: bind one field to an in-memory store and confirm the same matrix by toggling `matchMode` between case-sensitive / case-insensitive variants (the descriptor's `caseSensitive` flag is honored by [FilterDescriptor.ts:52-61](../src/typescript/lib/data/FilterDescriptor.ts#L52)).
- `graphify update .` — keeps the graph current.

---

## Documentation Impact

`AutoCompleteField` and `AutoCompleteFieldOptions` are already exported and documented; this change only widens a type union and refines two JSDoc blocks. No new public symbols, no rename, no removal.

- The expanded `AutoCompleteMatchMode` values appear automatically in the typedoc output for the `component/input` subpath. No barrel change.
- If there is a curated page for `AutoCompleteField` under `docs/components/`, add a short subsection covering the four `matchMode` values and the default. Otherwise this is a JSDoc-only update.
- No cross-bucket `{@link}` changes — `AutoCompleteMatchMode` lives in the same file as `AutoCompleteField`.

Per [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md), this counts as "consumer-visible behaviour change" only in the sense that two new enum values are reachable; the default behaviour does not change.

---

## Potential Challenges

- **Stale-query guard interacts with case-sensitive mode.** The `query === this._currentValue` check at [AutoCompleteField.ts:460](../src/typescript/lib/component/input/AutoCompleteField.ts#L460) and [:480](../src/typescript/lib/component/input/AutoCompleteField.ts#L480) is identity on the exact string the user typed — it is unaffected by case-folding. No change needed.
- **Existing call sites passing `'contains'` or `'startsWith'`.** The union widens, so existing literals still type-check. Confirm with a grep for `matchMode:` and `setMatchMode(` to make sure no exhaustive `switch` on the old union exists elsewhere — Community 33 shows the symbol is field-local, so no external consumers should branch on it.
- **Documentation of "case-insensitive default."** Update the JSDoc default note in `AutoCompleteFieldOptions.matchMode` and on `setMatchMode`; a stale "Default: `'contains'`" line without the parenthetical wastes a reader's time.

---

## Critical Files

- [`src/typescript/lib/component/input/AutoCompleteField.ts`](../src/typescript/lib/component/input/AutoCompleteField.ts) — only file with real edits.
- [`src/typescript/lib/data/FilterDescriptor.ts`](../src/typescript/lib/data/FilterDescriptor.ts) — read-only; confirms the store branch's `caseSensitive` flag is honored.
- [`plans/implemented/autocomplete.md`](implemented/autocomplete.md) — read-only; context for the original design.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — "options bag is the cache" / typed-setter rule that this change respects.

---

## Non-Goals

- **No `setCaseSensitive` setter.** The brief forbids a parallel toggle; everything routes through `setMatchMode`.
- **No new descriptor variant.** `FilterDescriptor` already carries `caseSensitive` on `contains` / `startsWith` — no schema change there.
- **No change to `AutoCompleteDropdown` / `AutoCompleteItem`.** Filtering stays in the field; the dropdown only ever sees the finished string list.
- **No backwards-compat shim.** Pre-existing `'contains'` / `'startsWith'` values continue to mean "case-insensitive" exactly as they do today; no aliasing, no deprecation.
- **No localisation-aware folding (`localeCompare` / `toLocaleLowerCase`).** Matching uses plain `toLowerCase`, matching the existing behaviour. Locale-aware matching would be a separate plan.
