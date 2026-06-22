---
depends-on: [data-field-types-and-validation]
touches-shared: [src/typescript/lib/data/ModelRecord.ts]
---

# Deep Value Equality for ModelRecord Dirty-Tracking — Implementation Plan

## Overview

`ModelRecord` decides whether a write changed anything by comparing the new value to the stored one through the static helper [`ModelRecord.isEqual`](../src/typescript/lib/data/ModelRecord.ts#L75). Today that helper special-cases `Date` (by `getTime()`) and otherwise falls back to `===` ([`ModelRecord.ts:75-81`](../src/typescript/lib/data/ModelRecord.ts#L75)). Reference equality is correct for primitives but wrong for objects and arrays: assigning a structurally-identical *new* array or object always reports a difference, so [`set()`](../src/typescript/lib/data/ModelRecord.ts#L63) flags the record dirty for a no-op write. That false positive pollutes [`isDirty()`](../src/typescript/lib/data/ModelRecord.ts#L97), would pollute `hasPendingChanges()`/`sync()` at the store layer, and — once the dependency plan lands — would surface phantom entries in `getChanges()`/`getModified()`.

This plan replaces the equality semantics with **deep structural equality** for plain objects and arrays, while keeping reference equality for class instances. It is a single-file, internal change to [`ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) plus its unit tests — no new exports, no public-surface change (unless the per-field hook option below is adopted; see Architecture Decisions).

**Dependency note.** This plan builds on [`data-field-types-and-validation.md`](./data-field-types-and-validation.md), which modifies `ModelRecord.set` (adds value conversion via `this._model.getField(field)?.convertValue(...)`) and adds `getChanges()`/`getModified()`, `clone()`, and `internalId`. That plan **explicitly defers** the shallow-equality limitation ("called out in Potential Challenges but not fixed, per scope" — [its Architecture Decision on `getChanges`](./data-field-types-and-validation.md)). This plan completes that deferral. All call sites of `isEqual` must be considered against the *post-dependency* shape of `set`/`getChanges`, not the current tree.

---

## Architecture Decisions

### Deep equality for plain objects and arrays; reference equality for class instances

`isEqual(a, b)` becomes:

1. **Identity / primitive fast path** — `a === b` returns `true` immediately (covers same-reference objects and all equal primitives except `NaN`).
2. **`NaN`** — `a !== a && b !== b` returns `true`, so two `NaN`s compare equal (a self-`set` of a `NaN`-valued numeric field is a no-op, not a dirty edit). This matches `SameValueZero`, the semantics `Array.prototype.includes`/`Map` keys use, and is the least-surprising choice for dirty-tracking.
3. **`null` / `undefined`** — once the `===` fast path fails, a `null` or `undefined` on either side cannot be deep-equal to the other operand, so return `false`. (`null === null` and `undefined === undefined` already returned `true` at step 1; `null` vs `{}`, `undefined` vs `null`, etc. correctly fall through to `false`.)
4. **`Date`** — preserved: both `Date` → compare `getTime()`. Kept ahead of the object branch because `Date` is technically an object but must compare by value.
5. **Arrays** — both arrays → equal length **and** element-wise `isEqual`. A `[1,2]` vs `{0:1,1:2}` mismatch is `false` (one is an array, one is not).
6. **Plain objects** — both are plain objects (see next decision) → same set of own enumerable keys and `isEqual` per key.
7. **Everything else** (class instances, functions, mismatched kinds) — fall through to `false` (the `===` at step 1 already handled same-reference instances).

This is a pure, field-agnostic structural comparison sufficient for the data values models actually hold (JSON-shaped records: primitives, dates, arrays, plain objects).

### Class instances compare by reference, not structurally

Deep-walking arbitrary class instances is unsafe: their meaningful identity may live in private state, getters, or prototype methods that a key-by-key walk ignores, and walking them risks traversing framework objects (a `Component`, a `Date` subclass, a `Map`). So step 6 applies **only to plain objects** — those whose prototype is `Object.prototype` or `null`. Detection: `const proto = Object.getPrototypeOf(x); proto === Object.prototype || proto === null`. A non-plain object that isn't the same reference and isn't a `Date` is treated as unequal (returns `false`), i.e. reference equality — the conservative choice that never silently treats two distinct instances as the same. This is documented behaviour, not a bug: model fields are expected to hold plain data; a field holding a live class instance keeps today's reference semantics.

### Cyclic references are out of scope and guarded by depth, not a visited-set

Plain-object/array model values are JSON-shaped and acyclic in practice (they come from proxy/store loads and `getData()` snapshots). A full cycle-detecting `WeakSet` pair-tracking implementation is more machinery than the data layer warrants. Instead the recursion carries a **depth budget** (`MAX_EQUALITY_DEPTH`, a named const) and, on exceeding it, falls back to `a === b` for that sub-comparison rather than recursing into a potential cycle / pathologically deep tree. This bounds worst-case cost and prevents a stack overflow on accidental cycles without paying for visited-set bookkeeping on every call. The limit and its rationale are documented inline per the magic-number convention. Genuinely cyclic field values are listed under Non-Goals.

### TRADEOFF — deep equality runs on every `set()`; recommendation: always-deep, no per-field flag

`isEqual` is called once per `set()` for the written field (the no-op guard) and once per existing field in the dirty-recompute loop ([`ModelRecord.ts:69-70`](../src/typescript/lib/data/ModelRecord.ts#L69)), plus once per field in `getChanges()` from the dependency plan. So a single `set()` already does O(fields) comparisons; making each comparison deep adds O(size-of-value) on top. For a field holding a large nested object, a single write now walks that structure.

Three options were weighed:

- **(a) Always deep** — simplest; one code path; correct dirty-tracking for every field with zero configuration. Cost is proportional to the *changed* value's size, and the common case (primitives, small arrays, small objects) is cheap. The deep walk short-circuits on the first mismatch and on the `===` identity fast path, so an unchanged large object that is the *same reference* (the overwhelmingly common no-op) costs O(1).
- **(b) Per-field hook** — add `FieldOptions.equals?: (a, b) => boolean` (mirroring the `convert` hook the dependency plan adds to `Field`) or a `FieldOptions.deepEquals?: boolean` flag, and make `isEqual` field-aware. Lets a field holding a huge nested blob opt into a cheaper custom comparator (e.g. compare a version stamp).
- **(c) Shallow-by-default, deep opt-in** — keeps today's behaviour as the default and requires every consumer to opt into correctness. Rejected: it preserves the false-positive-dirty bug for everyone who doesn't know to flip a flag — the bug this plan exists to fix.

**Recommendation: (a) always-deep.** The identity fast path makes the no-op-write hot path O(1) regardless of value size, so the added cost only materialises when a field is actually assigned a *different* object — which is exactly when a comparison is warranted. The data layer holds JSON-shaped values, not large binary blobs, so the realistic worst case is small. Introducing a per-field equality hook now is speculative configurability (CLAUDE.md §2) for a cost that the fast path already neutralises. If a concrete large-nested-field case appears later, option (b)'s `equals?` hook is the clean follow-up — and because that would change `isEqual`'s signature to be field-aware, the next decision records exactly what that future change would touch so it isn't a surprise.

### If a field-level hook is ever added, `isEqual` must become field-aware — recorded, not adopted

This plan keeps `isEqual` a **static, field-agnostic** helper (`private static isEqual(a, b): boolean`). Should option (b) be adopted in a future plan, `isEqual` would need a `field?: Field` parameter (or move to an instance method) so it can consult `field.getEquals?.()`, and **every call site** would have to thread the field through:

- the no-op guard in `set()` ([`ModelRecord.ts:64`](../src/typescript/lib/data/ModelRecord.ts#L64)) — already has `field` in scope (it is the `field` param / the looked-up `Field` from the dependency plan's conversion);
- the dirty-recompute loop ([`ModelRecord.ts:69-70`](../src/typescript/lib/data/ModelRecord.ts#L69)) — iterates `Object.keys(this._original)`, so each key would need `this._model.getField(k)`;
- `getChanges()` from the dependency plan — iterates fields and would pass each `Field`.

Recording this keeps the static signature an *intentional* choice, not an accident, and makes the future hook a localised change.

### Decomposition: a recursive private helper, not one fat `isEqual`

Per the decompose-large-functions convention, the deep walk is split: `isEqual(a, b)` stays as the public-facing static entry (identity, `NaN`, `null`/`undefined`, dispatch) and delegates structured cases to small private statics — `arraysEqual(a, b, depth)`, `plainObjectsEqual(a, b, depth)`, and an `isPlainObject(x)` predicate. Each has one nameable job and an explicit `@category Data` JSDoc-free internal comment (these are `private static`, not public API — no `@category` tag needed, but a one-line description each per the JSDoc convention for methods).

---

## Public API (TypeScript Signatures)

No public API change. `isEqual` and its helpers are `private static` on `ModelRecord`; they are not exported and carry no `@category` tag. Signatures (internal):

```typescript
// data/ModelRecord.ts — internal, private static
class ModelRecord {
    /** Structural value equality used for dirty-tracking: primitives by SameValueZero,
        Date by time, arrays/plain objects deep, class instances by reference. */
    private static isEqual(a: any, b: any): boolean;

    private static arraysEqual(a: any[], b: any[], depth: number): boolean;
    private static plainObjectsEqual(a: Record<string, any>, b: Record<string, any>, depth: number): boolean;
    private static isPlainObject(value: any): boolean;
}
```

The `depth` parameter is internal recursion bookkeeping; the entry `isEqual(a, b)` seeds it (calls helpers with `depth = 0`). It is not exposed to callers — `set()` and the dirty loop keep calling `ModelRecord.isEqual(x, y)` exactly as today.

---

## Internal Structure

`MAX_EQUALITY_DEPTH` module const (top of `ModelRecord.ts`, beside the dependency plan's `nextInternalId` counter):

```typescript
// Recursion cap for deep value equality. Model field values are JSON-shaped and
// acyclic in practice; this bound stops a pathologically deep or accidentally
// cyclic structure from overflowing the stack. Beyond it we fall back to `===`
// for that sub-comparison rather than tracking a visited-set on every set().
const MAX_EQUALITY_DEPTH = 100;
```

`isEqual` entry (dispatch):

```typescript
private static isEqual(a: any, b: any): boolean {
    return ModelRecord.isEqualAtDepth(a, b, 0);
}

private static isEqualAtDepth(a: any, b: any, depth: number): boolean {
    if (a === b) {
        return true;   // identity + equal primitives (NaN excluded)
    }

    if (a !== a && b !== b) {
        return true;   // both NaN
    }

    if (a === null || a === undefined || b === null || b === undefined) {
        return false;  // === above already handled the equal cases
    }

    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }

    if (depth >= MAX_EQUALITY_DEPTH) {
        return a === b;
    }

    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && ModelRecord.arraysEqual(a, b, depth);
    }

    if (ModelRecord.isPlainObject(a) && ModelRecord.isPlainObject(b)) {
        return ModelRecord.plainObjectsEqual(a, b, depth);
    }

    return false;   // class instances, functions, mismatched kinds
}
```

`arraysEqual` / `plainObjectsEqual` recurse via `isEqualAtDepth(..., depth + 1)`; `plainObjectsEqual` compares own-enumerable key sets (length + every key present on both) before recursing per key. `isPlainObject` returns `proto === Object.prototype || proto === null`.

> The public-facing static stays named `isEqual` for the unchanged call sites; the depth-carrying recursion is the private `isEqualAtDepth`. This keeps `set()` and the dirty loop calling `ModelRecord.isEqual(x, y)` verbatim.

---

## Ordered Implementation Steps

1. **`data/ModelRecord.ts`** — add the `MAX_EQUALITY_DEPTH` module const with its rationale comment. Replace the body of `isEqual` (currently [`ModelRecord.ts:75-81`](../src/typescript/lib/data/ModelRecord.ts#L75)) to delegate to a new private `isEqualAtDepth`, and add the private statics `isEqualAtDepth`, `arraysEqual`, `plainObjectsEqual`, `isPlainObject`, each with a one-line description comment. Leave the two existing call sites (`set` no-op guard, dirty-recompute loop) **unchanged** — they keep calling `ModelRecord.isEqual`. → verify: `npx tsc --noEmit` clean.
2. **Confirm no call-site drift** — `grep -n 'isEqual' src/typescript/lib/data/ModelRecord.ts` should show exactly the entry definition, `isEqualAtDepth`, the two existing call sites, and the recursive calls; no other file references it (it is `private static`). → verify: `grep -rn 'isEqual' src/typescript/lib/data/` returns matches only in `ModelRecord.ts`.
3. **Tests** — extend `tests/unit/data/ModelRecord.test.ts` with deep-equality cases (below). → verify: `npm test` green.
4. **Docs** — none required (internal change). Justified in Documentation Impact. → verify: n/a.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/data/ModelRecord.ts` |
| Modify | `tests/unit/data/ModelRecord.test.ts` |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` clean.
- **Unit tests** (`tests/unit/data/ModelRecord.test.ts`):
  - `set('tags', ['a','b'])` then `set('tags', ['a','b'])` (new array, equal contents) → `isDirty()` stays `false` after the second set when it matched the committed baseline; the no-op guard returns early.
  - Setting a structurally-identical plain object (`{ x: 1, y: { z: 2 } }`) to the same value → not dirty.
  - Setting a structurally-*different* array/object → dirty.
  - Arrays: different length → not equal; nested arrays → recursed.
  - Plain objects: different key sets, missing key, extra key → not equal.
  - `Date` by time still works (regression of the existing case).
  - `NaN` vs `NaN` → equal (no-op set of a `NaN` field does not dirty).
  - `null` vs `undefined` → not equal; `null` vs `{}` → not equal.
  - Class instance: two distinct instances with identical fields → **not** equal (reference semantics); same instance → equal via fast path.
  - Depth guard: a structure deeper than `MAX_EQUALITY_DEPTH` does not throw (falls back to `===`).
  - Integration with the dependency plan's `getChanges()` (if both are merged): assigning an equal-but-new array does not appear in `getChanges()`.
- **No docs build needed** — no public API moved.

---

## Documentation Impact

**None.** `isEqual` and its helpers are `private static` — not exported through [`src/typescript/lib/data/index.ts`](../src/typescript/lib/data/index.ts) and not part of any curated `docs/data/` page. The change is a pure behavioural fix to an internal helper; no barrel entry, no typedoc page, no sidebar edit. (Were option (b)'s `FieldOptions.equals?` hook adopted in a future plan, *that* would flow through `index.ts` via `FieldOptions` and require a `docs/data/model.md` note — but it is not adopted here; see Architecture Decisions.)

The behavioural change is consumer-visible in *effect* (records no longer false-dirty on equal object/array writes) but not in *API*. If `docs/data/record.md` documents dirty-tracking semantics, a one-line note that equality is structural for plain objects/arrays may be added at the implementer's discretion; it is not required for the docs build.

---

## Potential Challenges

- **Class instances as field values.** If any existing model field is expected to hold a live class instance and relies on *structural* comparison, this plan keeps it at reference equality — which is the same as today's `===`, so no regression, but worth a grep of real model definitions for object-typed fields. Mitigation: reference semantics for non-plain objects is the conservative, no-regression choice.
- **`Date` ordering vs the array/object branches.** The `Date` check must stay *above* `isPlainObject`/`Array.isArray` (a `Date` is an object). Mitigation: ordering fixed in `isEqualAtDepth` as written; covered by the `Date` regression test.
- **Sparse / non-index array keys.** `arraysEqual` compares by length + index; an array with extra non-index own props is an edge case not handled (treated as equal if indices match). Mitigation: model values don't carry such arrays; documented as out of scope.
- **Interaction with the dependency plan's conversion in `set`.** The dependency plan converts the value *before* the `isEqual` no-op guard. So `isEqual` compares the *converted* new value against the stored (already-converted) value — which is correct, and means a `'2020-01-01'` string set onto a `date` field is compared as a `Date`, hitting the `Date` branch. Mitigation: no ordering change needed; the conversion-then-compare order in the dependency plan's `set` already feeds typed values to `isEqual`.

---

## Critical Files

- [`src/typescript/lib/data/ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) — `isEqual` (the helper to rewrite), `set` no-op guard ([L64](../src/typescript/lib/data/ModelRecord.ts#L64)), dirty-recompute loop ([L69-70](../src/typescript/lib/data/ModelRecord.ts#L69)).
- [`plans/data-field-types-and-validation.md`](./data-field-types-and-validation.md) — the dependency; defines the post-conversion shape of `set` and the `getChanges()` consumer this plan must stay compatible with.
- [`tests/unit/data/ModelRecord.test.ts`](../tests/unit/data/ModelRecord.test.ts) — test conventions to mirror.
- [`src/typescript/lib/data/Field.ts`](../src/typescript/lib/data/Field.ts) — only relevant if option (b)'s `equals?` hook is ever adopted; not touched by this plan.

---

## Non-Goals

- **Per-field equality hook (`FieldOptions.equals?` / `deepEquals?`).** Recorded as the clean follow-up if a large-nested-field cost case appears, but not adopted — the identity fast path neutralises the cost for the common no-op write.
- **Cyclic field values.** Bounded by `MAX_EQUALITY_DEPTH` (fall back to `===`), not fully supported via visited-set tracking.
- **Structural equality for class instances / `Map` / `Set` / typed arrays.** These keep reference equality.
- **Conversion, validation, or event changes.** Owned by the dependency plan; this plan only touches equality semantics for dirty-tracking.
- **Making `isEqual` field-aware now.** The static, field-agnostic signature is retained intentionally; the field-aware change is documented as a future option only.
