# Field Type Conversion + Validation + Record-Layer Additions — Implementation Plan

## Overview

This plan closes three gaps in the model/record layer under [`src/typescript/lib/data/`](../src/typescript/lib/data/), the foundation of a larger data-layer completeness effort. Scope is strictly **Model / Field / Record** — no store, proxy, sort/filter, or association work.

Today a [`Field`](../src/typescript/lib/data/Field.ts#L36) declares a [`type`](../src/typescript/lib/data/Field.ts#L8) and `getType()` is read by the table layer ([`Table.ts:472`](../src/typescript/lib/component/table/Table.ts#L472), [`Row.ts:374`](../src/typescript/lib/component/table/Row.ts#L374)) to pick cell renderers, but the data layer never coerces raw values: [`AbstractModel.createRecord`](../src/typescript/lib/data/AbstractModel.ts#L107) copies raw source values straight through ([`AbstractModel.ts:124-130`](../src/typescript/lib/data/AbstractModel.ts#L124)). A JSON date stays a string; `"10"` sorts before `"9"`. There are also no validators, and [`ModelRecord`](../src/typescript/lib/data/ModelRecord.ts#L26) lacks change introspection, cloning, and any stable id for unsynced rows ([`getId()`](../src/typescript/lib/data/ModelRecord.ts#L149) returns `undefined` until the server replies).

The work adds: (1) type-driven value conversion plus a per-field `convert` hook, run at ingest in `createRecord`; (2) field-level validation reusing the **existing** [`validation`](../src/typescript/lib/validation/index.ts) subpath's [`ValidationRule`](../src/typescript/lib/validation/ValidationRule.ts#L14) union and [`applyRule`](../src/typescript/lib/validation/Validator.ts#L16) evaluator, surfaced through a pull-based `ModelRecord` API; and (3) record-layer additions — `getChanges()`/`getModified()`, `clone()`, and a construction-time `internalId`.

A `validation` subpath already exists with a discriminated-union rule type and a stateless pure evaluator. We reuse it rather than inventing a parallel rule system in `data/`.

---

## Architecture Decisions

### Conversion runs at ingest in `createRecord`, and also in `ModelRecord.set` — via one shared `Field.convertValue`

The raw → typed coercion belongs at the boundary where external data enters the record. `createRecord` is that boundary for proxy/store loads, so conversion lands there ([`AbstractModel.ts:126-130`](../src/typescript/lib/data/AbstractModel.ts#L126)). But ingest-only conversion leaves a hole: a programmatic `record.set('birthday', '2020-01-01')` would re-introduce an un-coerced string, defeating the sort/filter guarantee the conversion exists to provide. So `ModelRecord.set` also converts, through the **same** `Field.convertValue(raw, sourceRecord?)` method, keeping one coercion path. `set` looks the field up via `this._model.getField(name)`; if the name is not a model field (no `Field`), the value passes through unchanged (preserves today's permissive behaviour).

Conversion is the single source of truth for "what's stored," so sort and filter — which compare stored values — get correct ordering for free: numbers compare numerically, dates compare as `Date` objects, booleans as real booleans. No separate "sort comparator per type" is needed downstream.

### `convert` precedence and the type-driven default

`FieldOptions.convert?: (raw: any, sourceRecord?: Record<string, any>) => any` is an explicit per-field hook and wins when present. When absent, conversion is driven by `type`:

| `type` | Coercion |
|---|---|
| `number` | `Number(raw)`; `''`/`null`/`undefined` → `undefined` (not `NaN`) |
| `boolean` | `true`/`1`/`'true'`/`'1'`/`'yes'` → `true`; `false`/`0`/`'false'`/`'0'`/`'no'`/`''` → `false`; else `Boolean(raw)` |
| `date` / `datetime` / `time` | `raw instanceof Date` passthrough; else `new Date(raw)`; invalid (`NaN` time) → `undefined` |
| `string` | `String(raw)` |
| `auto` / `glyph` | passthrough (unchanged) |

`null`/`undefined` raw values short-circuit to themselves for **every** type before the table above runs, so an absent value never becomes `NaN`, `"null"`, or an Invalid Date. `defaultValue` substitution in `createRecord` happens **before** conversion, so a typed default (e.g. `defaultValue: 0`) and a raw default both flow through the same coercion. The `sourceRecord` argument is the full mapped source object, passed only by `createRecord` (so a custom `convert` can derive a field from sibling raw values); `set` passes the current record data.

### Conversion is a `Field` method, not free functions in `AbstractModel`

`Field` already owns type knowledge (`getType`, `getDefaultValue`). Coercion is per-field behaviour, so `Field.convertValue` lives on `Field`, caching the optional `convert` callback in `_convert`. This keeps `createRecord` a thin orchestration loop and lets `set` reuse the exact same logic. The built-in type switch is a `private` helper on `Field` (`convertByType`), per the decompose-large-functions convention.

### Validation reuses the `validation` subpath; rules attach to `Field`, evaluation lives on `ModelRecord`

The [`validation`](../src/typescript/lib/validation/index.ts) subpath already defines the rule vocabulary the brief asks for — [`ValidationRule`](../src/typescript/lib/validation/ValidationRule.ts#L14) is a discriminated union of `required`, `minLength`/`maxLength` (length `{min,max}`), `min`/`max` (range `{min,max}`), `regex` (`pattern`), and `custom` (predicate) — and [`applyRule`](../src/typescript/lib/validation/Validator.ts#L16) is a stateless pure evaluator with sensible default messages. We add `validators?: ValidationRule[]` to `FieldOptions`, cache it on `Field` as `_validators`, and expose `Field.getValidators(): ValidationRule[]`. `ModelRecord` runs them by importing `applyRule`.

This is a deliberate cross-subpath dependency: `data/` imports a **type** and one **pure function** from `validation/`. There is no DOM or component coupling (`applyRule` is documented as DOM-free), and it avoids a second, divergent rule enum. The alternative — a `data`-local rule type — was rejected because it would duplicate the exact union the brief enumerates and force the form/binding layer to translate between two rule shapes.

`required`/`type`/`length`/`range`/`pattern`/`custom` map onto existing rule variants, **except** the brief's `type` validator (e.g. "must be a number"). `applyRule` has no `type` variant. Rather than extend the shared union (which would ripple into [`FieldDecorator`](../src/typescript/lib/validation/FieldDecorator.ts) and `Binding`), `ModelRecord.validateField` runs an **implicit, conversion-derived type check first**: if the field declares a non-`auto`/`glyph` `type` and the stored value is non-null but fails coercion (e.g. `number` field holding `NaN`, `date` field holding an Invalid Date), that field reports a type error before the explicit `validators` run. This keeps the type check where the type knowledge already is and needs no rule-union change.

### Validation is pull-based and event-free on `ModelRecord`

`ModelRecord` has no event system today and this plan keeps it that way. `isValid()`, `getErrors()`, and `validateField(name)` compute on demand from current `_data` and field schema — no cached validity state, no listeners. The store/form layer (a separate plan) polls these after edits. Rationale: validity is a pure function of current data + schema, so caching it would only create a staleness bug surface (a cached flag drifting from `_data` after `set`). Pull-based is also what the existing `validation` evaluator already assumes — `applyRule` is a pure call. Keeping the record event-free preserves its current minimal contract and defers any reactive wiring to the layer that owns UI feedback.

### `internalId` is assigned at construction from a module counter

Records get `private _internalId: number`, assigned in the constructor from a module-scoped monotonic counter, and exposed via `getInternalId(): number`. This gives UI a stable key for unsynced rows before `getId()` (primary key) resolves — `getId()` is unchanged and still returns the PK value (or `undefined`). The id is a plain incrementing `number` (cheap, collision-free within a session); a UUID is unnecessary because the id never leaves the client. `clone()` produces a **new** `internalId` (a clone is a distinct row), and a cloned record is marked new and dirty so the store treats it as an insert.

### `getChanges()`/`getModified()` reuse the existing shallow `isEqual`

`getChanges()` returns a `Record<string, FieldChange>` (`{ old, new }`) for every field whose current value differs from `_original`, using the existing [`ModelRecord.isEqual`](../src/typescript/lib/data/ModelRecord.ts#L75) (which already special-cases `Date`). `getModified()` is an alias-by-intent returning the same map (the brief lists both names); to avoid two implementations, `getModified()` delegates to `getChanges()`. The shallow-equality limitation noted in the brief ([`ModelRecord.ts:75`](../src/typescript/lib/data/ModelRecord.ts#L75)) is **left as-is** — object/array field values still compare by reference. This is called out in Potential Challenges but not fixed, per scope.

---

## Public API (TypeScript Signatures)

```typescript
// data/Field.ts — FieldOptions additions
export interface FieldOptions {
    name: string;
    type?: FieldType;
    defaultValue?: any;
    mapping?: string;
    description?: string;
    order?: number;
    /** Custom raw→typed coercion; wins over the built-in type conversion. */
    convert?: (raw: any, sourceRecord?: Record<string, any>) => any;
    /** Field-level validation rules, evaluated by ModelRecord (pull-based). */
    validators?: ValidationRule[];   // imported: import type { ValidationRule } from '~/validation/ValidationRule.js'
}

// data/Field.ts — Field additions
class Field {
    /** Coerces a raw value to this field's type, or runs the custom `convert` hook. */
    convertValue(raw: any, sourceRecord?: Record<string, any>): any;
    /** Returns the configured validation rules, or an empty array. */
    getValidators(): ValidationRule[];
    private convertByType(raw: any): any;   // built-in type switch
}
```

```typescript
// data/ModelRecord.ts — new exported type
/** A single field's before/after values, as returned by getChanges/getModified. */
export interface FieldChange {
    old: any;
    new: any;
}

class ModelRecord {
    /** Stable client-side id assigned at construction; survives before the server PK exists. */
    getInternalId(): number;
    /** Map of changed field name → { old, new } since the last commit. */
    getChanges(): Record<string, FieldChange>;
    /** Alias of getChanges() — map of modified fields → { old, new }. */
    getModified(): Record<string, FieldChange>;
    /** Deep-ish copy of this record with a fresh internalId, marked new+dirty. */
    clone(): ModelRecord;
    /** True when every field passes its type check and validators. */
    isValid(): boolean;
    /** Per-field error messages for currently-invalid fields. */
    getErrors(): Record<string, string>;
    /** First failing message for one field, or '' when valid / not a field. */
    validateField(name: string): string;
}
```

---

## Internal Structure

`Field.convertValue` (orchestration):

```typescript
convertValue(raw: any, sourceRecord?: Record<string, any>): any {
    if (this._convert) {
        return this._convert(raw, sourceRecord);
    }

    if (raw === null || raw === undefined) {
        return raw;
    }

    return this.convertByType(raw);
}
```

`createRecord` ingest loop change (default before convert):

```typescript
for (const field of this._resolvedFields!) {
    const raw = source[field.getMapping()];
    const value = raw !== undefined ? raw : field.getDefaultValue();

    mapped[field.getName()] = field.convertValue(value, source);
}
```

`ModelRecord.validateField` (type check, then rules):

```typescript
validateField(name: string): string {
    const field = this._model.getField(name);

    if (!field) {
        return '';
    }

    const value = this._data[name];
    const typeError = this.checkType(field, value);   // private: non-null + non-auto/glyph + failed coercion

    if (typeError) {
        return typeError;
    }

    for (const rule of field.getValidators()) {
        const result = applyRule(rule, value);

        if (!result.valid) {
            return result.message;
        }
    }

    return '';
}
```

Module counter for `internalId` (top of `ModelRecord.ts`):

```typescript
// Monotonic per-session id source for client-side row keys; never leaves the client,
// so a plain counter suffices (no UUID / collision concern across sessions).
let nextInternalId = 1;
```

---

## Ordered Implementation Steps

1. **`data/Field.ts`** — add `convert?` and `validators?` to `FieldOptions`; import `type { ValidationRule }` from `~/validation/ValidationRule.js`. Add `_convert` and `_validators` backing fields, set them in the constructor. Add `convertValue`, private `convertByType`, and `getValidators` with `@category Data` JSDoc. → verify: `npx tsc --noEmit` clean.
2. **`data/AbstractModel.ts`** — in `createRecord`, substitute `defaultValue` into a local `value`, then store `field.convertValue(value, source)`. → verify: existing `tests/unit/data/Field.test.ts` + `MemoryStore.test.ts` still pass.
3. **`data/ModelRecord.ts`** — import `applyRule` from `~/validation/Validator.js`; add module counter + `_internalId` (assigned in constructor); convert in `set` via `this._model.getField(field)?.convertValue(...)` with passthrough when no field; add `FieldChange` interface, `getChanges`/`getModified`/`clone`/`getInternalId`/`isValid`/`getErrors`/`validateField` and private `checkType`. → verify: `tests/unit/data/ModelRecord.test.ts` passes.
4. **`data/index.ts`** — export `type { FieldChange }` from `ModelRecord.js`. (`ValidationRule` is already exported from the `validation` barrel; consumers import it from there. Field's `convert`/`validators` fields need no new export beyond `FieldOptions`, which is already exported.) → verify: `grep -n FieldChange src/typescript/lib/data/index.ts`.
5. **Tests** — extend `tests/unit/data/Field.test.ts` (convertValue per type, custom convert, null passthrough, getValidators) and `tests/unit/data/ModelRecord.test.ts` (set converts, getChanges/getModified, clone fresh internalId + new+dirty, isValid/getErrors/validateField incl. implicit type check). → verify: `npm test` green.
6. **Docs** — see Documentation Impact. → verify: `npm run docs:build` 0 errors / 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/data/Field.ts` |
| Modify | `src/typescript/lib/data/AbstractModel.ts` |
| Modify | `src/typescript/lib/data/ModelRecord.ts` |
| Modify | `src/typescript/lib/data/index.ts` |
| Modify | `tests/unit/data/Field.test.ts` |
| Modify | `tests/unit/data/ModelRecord.test.ts` |
| Modify | `docs/data/model.md` |
| Modify | `docs/data/record.md` |
| Modify (if needed) | `docs/.vitepress/config.mts` (only if a new page is added — none planned) |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` clean.
- **Unit tests:** `npm test` — new cases for conversion (each `FieldType`, custom `convert`, null/undefined passthrough, default-before-convert), `set` coercion + passthrough for unknown field, `getChanges`/`getModified` ({old,new} map; empty when clean), `clone` (fresh `internalId`, `isNew` + `isDirty` true, deep-copied `_data`), `getInternalId` monotonic/unique, `isValid`/`getErrors`/`validateField` (required, length, range, pattern, custom, and the implicit type check on a `number`/`date` field holding garbage).
- **Sort/filter correctness smoke:** build a `Model` with a `number` field, `createRecord` from `{ n: '10' }` and `{ n: '9' }`, assert `getData().n === 10` (number, not string) — demonstrates the ordering benefit downstream.
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **Barrel:** `FieldChange` is newly exported from `src/typescript/lib/data/index.ts` (the `data` subpath barrel — no root barrel). `@category Data` on the interface. `ValidationRule` is already exported by the `validation` barrel; the new `FieldOptions.convert`/`validators` and the new `ModelRecord`/`Field` methods all carry `@category Data` JSDoc.
- **Curated pages:** update `docs/data/model.md` (document `convert`, `validators`, and that values are coerced to `type` at ingest) and `docs/data/record.md` (document `getChanges`/`getModified`, `clone`, `getInternalId`, and the pull-based `isValid`/`getErrors`/`validateField`). Both are already in the `/data/` sidebar of `docs/.vitepress/config.mts` (lines 182, 185) and listed in `docs/data/index.md` — no new sidebar entries needed, so `config.mts` only changes if a new page is introduced (not planned).
- **Cross-bucket JSDoc:** any JSDoc in `data/` that references `ValidationRule` must use the markdown-link form `[\`ValidationRule\`](/api/validation/type-aliases/ValidationRule)`, not `{@link}`, because TypeDoc bundles per subpath and `data` ≠ `validation` (per `_shared/docs-conventions.md`).

---

## Potential Challenges

- **Cross-subpath import direction.** `data/` importing from `validation/` must not create a cycle — confirm `validation/` does not import from `data/` (it imports `core/Component`, not `data`). Mitigation: import only the `ValidationRule` type and `applyRule` function; verify with `npx tsc --noEmit`.
- **Conversion in `set` could surprise callers passing already-typed values.** A `Date` passed to a `date` field must pass through unchanged — `convertByType` handles `instanceof Date` first; covered by a test.
- **Shallow `isEqual` in `getChanges`.** Object/array field values compare by reference, so a mutated-in-place object won't show in `getChanges` (same as today's `isDirty`). Noted, not fixed — out of scope per brief.
- **`internalId` and serialization.** `getData()` must **not** include `internalId` (it is not a field) — it lives in a private backing field, never in `_data`, so `getData`/proxy writers are unaffected.

---

## Critical Files

- [`src/typescript/lib/data/Field.ts`](../src/typescript/lib/data/Field.ts) — options bag, type knowledge, where `convertValue`/`getValidators` land.
- [`src/typescript/lib/data/AbstractModel.ts`](../src/typescript/lib/data/AbstractModel.ts) — `createRecord` ingest loop (the conversion site).
- [`src/typescript/lib/data/ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) — `set`/`isEqual`/`getId`; host for all record-layer additions.
- [`src/typescript/lib/validation/ValidationRule.ts`](../src/typescript/lib/validation/ValidationRule.ts) and [`Validator.ts`](../src/typescript/lib/validation/Validator.ts) — the reused rule union and `applyRule` evaluator.
- [`src/typescript/lib/data/index.ts`](../src/typescript/lib/data/index.ts) — export surface.
- [`tests/unit/data/Field.test.ts`](../tests/unit/data/Field.test.ts), [`tests/unit/data/ModelRecord.test.ts`](../tests/unit/data/ModelRecord.test.ts) — test conventions to mirror.

---

## Non-Goals

- **Store / proxy / sort / filter / association changes** — separate plans; this plan only makes stored values correctly typed so those layers benefit.
- **Deep equality in `isEqual`** — explicitly left shallow per brief.
- **Events on `ModelRecord`** — validation stays pull-based; no listener wiring.
- **Extending the shared `ValidationRule` union with a `type` variant** — the implicit conversion-based type check covers it without rippling into `FieldDecorator`/`Binding`.
- **`internalId` persistence or server round-tripping** — it is a client-only session key.
