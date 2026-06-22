# Priority 1 — Pure-logic unit tests (no DOM) — Implementation Plan

## Overview

This plan adds Vitest unit tests for pure-logic library modules under `src/typescript/lib/` that currently have **no** coverage. Every target runs under the default `node` Vitest environment — none imports `Component`, the DOM, or any browser global — so no `// @vitest-environment jsdom` opt-in is needed.

The data-layer targets are the sort/comparison primitive [`data/compareValues.ts`](../src/typescript/lib/data/compareValues.ts), the filter algebra [`data/FilterDescriptor.ts`](../src/typescript/lib/data/FilterDescriptor.ts), and the proxy serializers [`data/proxy/Reader.ts`](../src/typescript/lib/data/proxy/Reader.ts) and [`data/proxy/Writer.ts`](../src/typescript/lib/data/proxy/Writer.ts). The primitive targets are [`primitive/Border.ts`](../src/typescript/lib/primitive/Border.ts), [`primitive/Point.ts`](../src/typescript/lib/primitive/Point.ts), [`primitive/Size.ts`](../src/typescript/lib/primitive/Size.ts), [`primitive/Position.ts`](../src/typescript/lib/primitive/Position.ts), [`primitive/Placement.ts`](../src/typescript/lib/primitive/Placement.ts), [`primitive/BorderStyle.ts`](../src/typescript/lib/primitive/BorderStyle.ts), and the two type-alias-only modules [`primitive/Edge.ts`](../src/typescript/lib/primitive/Edge.ts) and [`primitive/Axis.ts`](../src/typescript/lib/primitive/Axis.ts).

Tests live under `tests/unit/`, mirroring the existing layout: data tests under `tests/unit/data/` and `tests/unit/data/proxy/`, primitive tests in a new `tests/unit/primitive/` directory (the existing [`tests/unit/Insets.test.ts`](../tests/unit/Insets.test.ts) sits at the `tests/unit/` root, but a `primitive/` subfolder keeps the eight new primitive specs together and mirrors the `data/` convention). All imports use the `~/...` alias resolved by [`vitest.config.ts`](../vitest.config.ts) via `mergeConfig(viteConfig, …)`.

---

## Architecture Decisions

### Assert the contract, not the current output — the load-bearing rule

This is a test-authoring plan, and its single most important constraint: **every assertion must encode the module's *specified* behaviour, derived independently of the current line-by-line implementation, then checked against it.** The risk in test-after authoring is writing `expect(f(x)).toBe(<whatever f currently returns>)`, which locks in bugs as "expected" and makes the suite a regression net for wrong behaviour.

For **every** module below, the implementer must:

1. **Derive expected behaviour first** from the contract — the module's JSDoc, type signatures, naming, and how real callers use it (callers are enumerated per-module below so this is grounded, not guesswork). Write the expected value down *before* running the code.
2. **Write the assertion against that derived expectation**, not against observed output.
3. **On divergence, STOP.** If the code's actual output disagrees with the contract-derived expectation, do not silently rewrite the assertion to match the code. Instead:
   - Re-derive — confirm the expectation is actually what the contract promises (the bug may be in our reading).
   - If the expectation still holds and the code disagrees, **surface it explicitly**: flag it for the user in the implementation report, AND encode it in the suite as a deliberately-failing marker — `it.fails('<describes the contract the code violates>', …)` when the divergence is a genuine code bug we want pinned, or a `// DIVERGENCE:` comment above a `it.todo` when it's ambiguous. Never delete the case or flip the expectation to green just to pass.

This section is the spine of the plan; the per-module behaviour lists below exist to feed step 1. The implementer should treat each listed behaviour as "here is the contract — derive the expected value, then verify."

### Test style mirrors the existing suites

Match [`tests/unit/Insets.test.ts`](../tests/unit/Insets.test.ts) and [`tests/unit/data/proxy/MemoryProxy.test.ts`](../tests/unit/data/proxy/MemoryProxy.test.ts): `import { describe, it, expect } from 'vitest'` (the config sets `globals: true`, but the existing files still import explicitly — follow them), one top-level `describe(<ModuleName>)`, terse one-line `it()` descriptions phrased as behaviour, `~/...` imports. Use `toEqual` for structural equality, `toBe` for primitives/identity, `toBeLessThan(0)` / `toBeGreaterThan(0)` for sign-only comparator assertions (never assert the exact magnitude `-1`/`1` of a `localeCompare`, which is implementation-defined — assert the *sign*).

### Type-alias-only modules get a compile-time smoke test, not runtime asserts

[`Edge.ts`](../src/typescript/lib/primitive/Edge.ts) and [`Axis.ts`](../src/typescript/lib/primitive/Axis.ts) export **only** `type`/union aliases — `HorizontalSide`, `VerticalSide`, `Edge`, `AxisOrientation`, `AxisPosition`, `AxisEnd`, `AxisSpread`. They carry no runtime values, so there is nothing to execute and nothing for V8 coverage to count. They are listed as targets, so give each a single minimal spec that exercises the type contract at compile time (typed `const` assignments that must type-check, asserted trivially at runtime), rather than inventing runtime behaviour the module doesn't expose. Keep these deliberately thin — over-testing a type alias is noise. If the implementer judges these add no value, they should say so in the report rather than padding.

### Comparator sign, not magnitude

`compareValues` and the `localeCompare`/`<`/`>` paths return *a* negative/zero/positive number, not specifically `±1`. Assert with `toBeLessThan(0)` / `toBe(0)` / `toBeGreaterThan(0)`. The only place an exact value is contractually `0` is the equal case.

---

## Per-module behaviour to cover

### `data/compareValues.ts` → `tests/unit/data/compareValues.test.ts`

Contract source: the JSDoc on [`compareValues`](../src/typescript/lib/data/compareValues.ts#L18) (ascending sense; null/undefined sort **last**; string/locale, date-by-`getTime`, else native) plus the caller [`AbstractStore.compareBySorter`](../src/typescript/lib/data/AbstractStore.ts#L1739), which leaves a null-involving result **un-negated** so nulls stay last under both `asc` and `desc`. `FieldType` values are `'string' | 'number' | 'boolean' | 'date' | 'time' | 'datetime' | 'glyph' | 'auto'` ([`Field.ts:10`](../src/typescript/lib/data/Field.ts#L10)).

Behaviours to pin (derive each expected sign from the contract first):
- **Both null/undefined → exactly `0`.** Cover `(null, null)`, `(undefined, undefined)`, and the mixed `(null, undefined)` pair — the `== null` guard treats `undefined` as null, so all three must be `0`.
- **Single null sorts last, regardless of direction.** `compareValues(null, 5)` is **positive** (null after non-null) and `compareValues(5, null)` is **negative** — and critically, the value is the *same sign* irrespective of any `type`, because the null guards run before the type switch. This is the property `compareBySorter` relies on to keep nulls last under `desc`.
- **Numeric native ordering.** `(1, 2, 'number')` negative; `(2, 1, 'number')` positive; `(2, 2, 'number')` zero. Also verify the no-`type` path: two numbers with `type` omitted still go native (not locale), so `(2, 10)` is **negative** (numeric), which a string compare would get wrong (`'10' < '2'`).
- **String locale ordering.** With `type: 'string'`: `('a', 'b')` negative, `('b', 'a')` positive, `('a', 'a')` zero. Pin the locale contract from the JSDoc: `'Ä'` orders **between** `'a'` and `'Z'`, not after `'Z'` — assert `compareValues('Ä', 'Z', 'string') < 0` and `compareValues('Ä', 'a', 'string') > 0`. (Assert signs only; magnitudes are locale-defined.)
- **Type-inference locale path.** With `type` omitted and **both** operands strings, the locale path is taken (`('b', 'a')` positive). With `type` omitted and operands non-string, native path. Worth a case proving a mixed `(string, number)` with no type falls through to native `<`/`>` rather than throwing.
- **Date by timestamp.** With `type: 'date'` (and `'time'`, `'datetime'`), two `Date` operands compare by `getTime()`: earlier date negative, later positive, equal-instant zero. Also pin the documented fall-through: when `type` is a date type but the operands are **not** both `Date` (e.g. numbers, or ISO strings), the function falls through to `nativeCompare` rather than erroring — derive and assert that (e.g. `(1, 2, 'date')` negative).
- **`localeCompare` is only reached for the string branch** — sanity case that a `boolean`/`number` type never invokes locale semantics (covered implicitly by the numeric cases, but a `(true, false, 'boolean')` native case documents it).

### `data/FilterDescriptor.ts` → `tests/unit/data/FilterDescriptor.test.ts`

Contract source: the `FilterDescriptor` union and the `matchesFilter` JSDoc ("works with both plain data objects and ModelRecord-like objects exposing `get(field)`"). Caller [`StoreWorker`](../src/typescript/lib/data/StoreWorker.ts#L70) feeds **plain objects** (worker side); caller [`AbstractStore`](../src/typescript/lib/data/AbstractStore.ts#L1699) feeds **`ModelRecord`** instances (main side). `readField` ([`FilterDescriptor.ts:29`](../src/typescript/lib/data/FilterDescriptor.ts#L29)) is the dual-mode reader: prefers `record.get(field)` when present, else `record[field]`.

Behaviours to pin:
- **Dual record access.** Every leaf operator should be proven once against a plain object `{ name: 'Bob' }` and once against a stub exposing `get(field)` (a minimal `{ get: (f) => …}` literal is enough — no need to import `ModelRecord`, matching the contract that *any* `get`-bearing object works; but the implementer may import `ModelRecord` + `Model` instead if they prefer parity with `MemoryProxy.test.ts`). At minimum prove `eq` works through both shapes; the rest can use plain objects.
- **`eq` / `neq`** use **strict** `===`/`!==`: `eq` field `1` vs value `1` true, vs `'1'` false (no coercion). `neq` is the boolean inverse.
- **`contains`** substring, case-insensitive by **default**; `caseSensitive: true` makes it exact-case. Null/undefined field value → `false` (the `raw == null` guard), never a throw. Non-string raw is `String()`-coerced (e.g. number `123` contains `'2'`).
- **`startsWith`** same null/case rules as `contains` but anchored at index 0: `'Bob'` startsWith `'Bo'` true, `'ob'` false.
- **`gt` / `gte` / `lt` / `lte`** relational via raw `>`/`>=`/`<`/`<=`. Derive the contract from the union's value type `number | string | Date`: numbers compare numerically, strings lexically, Dates by valueOf. Pin boundary: `gt(5,5)` false, `gte(5,5)` true. **Edge worth surfacing:** an undefined field value makes every relational op `false` (because `undefined > x`, `undefined < x` are all `false`) — derive whether that matches intent and note it; this is a likely "surface it" candidate if it surprises.
- **`in`** membership via `Array.prototype.indexOf` → strict equality, so `in` over `[1,2]` matches field `1` but not `'1'`.
- **`and`** — all sub-filters must match (empty `filters: []` → vacuously `true`); short-circuits on first false. **`or`** — any sub-filter matches (empty → vacuously `false`). **`not`** — boolean inverse of its single child. Cover one nested case (e.g. `and` of [`eq`, `not(eq)`]) to prove recursion.

### `data/proxy/Reader.ts` → `tests/unit/data/proxy/Reader.test.ts`

Contract source: `JsonReader` JSDoc and the existing [`AjaxProxy.test.ts`](../tests/unit/data/proxy/AjaxProxy.test.ts) cases (lines 80–100) that already exercise the reader *through* the proxy — these tests pin `JsonReader` **directly** so the unit is covered without the fetch harness. `read(raw, paginated)` branches to `readEnvelope` (paginated) or `readArray` (unpaginated). Defaults: `rootProperty: 'data'`, `totalProperty: 'total'`, `root: undefined`.

Behaviours to pin:
- **Unpaginated, no root** → returns `{ records: <the top-level array> }` when `raw` is an array; throws `Error` matching `/not an array and no root/` when `raw` isn't an array.
- **Unpaginated, with `root`** → unwraps `raw[root]`; returns `{ records }` when that's an array; throws `/root '<root>' did not resolve to an array/` otherwise.
- **Paginated, default keys** → from `{ data: [...], total: 42 }` returns `{ records, total: 42 }`. `total` is carried **only when numeric** — a non-number `total` (or missing) yields `total: undefined` (assert this; it's a documented coercion). `success`/`message` are carried only when `boolean`/`string` respectively, else `undefined`.
- **Paginated, custom `rootProperty`/`totalProperty`** → reads the configured keys (e.g. `{ rows: [...], count: 7 }` with `rootProperty: 'rows', totalProperty: 'count'`).
- **Paginated, with `root`** → unwraps `raw[root]` to the envelope first, then reads keys from it.
- **Paginated error shapes** → `raw` null/non-object envelope throws `/not an envelope object/`; envelope whose `rootProperty` isn't an array throws `/'data' is not an array/`. Assert via `toThrow(<regex>)`. Derive the messages from the source rather than copying — they must match the contract the proxy advertises.

### `data/proxy/Writer.ts` → `tests/unit/data/proxy/Writer.test.ts`

Contract source: `JsonWriter` JSDoc — `writeRecord` is `JSON.stringify(record.getData())`; `writeRecords` is `JSON.stringify(records.map(r => r.getData()))`. Build records via `new Model([...], 'id')` + `new ModelRecord(model, data)` exactly as `MemoryProxy.test.ts`/`AjaxProxy.test.ts` do (`AjaxProxy.test.ts` already asserts `body === JSON.stringify(record.getData())`, confirming this is the contract).

Behaviours to pin:
- **`writeRecord`** of a single record equals `JSON.stringify(record.getData())` — derive expected by computing `record.getData()` in the test and stringifying, then assert equality (don't hand-write a JSON literal that bakes in field ordering). Use a record with at least two fields so the data shape is non-trivial.
- **`writeRecords`** of a batch equals `JSON.stringify(records.map(r => r.getData()))` — assert it produces a JSON **array** in input order; a single-element batch and an empty batch (`[]` → `'[]'`) both worth covering.
- The two interfaces `Reader`/`Writer` need no separate test — they're structural types with no runtime; `JsonReader`/`JsonWriter` cover them.

### `primitive/Border.ts` → `tests/unit/primitive/Border.test.ts`

Two exported functions. Callers: [`Component.ts`](../src/typescript/lib/core/Component.ts), [`Button.ts`](../src/typescript/lib/component/button/Button.ts), [`ToggleButton.ts`](../src/typescript/lib/component/button/ToggleButton.ts).

`borderToStyle` behaviours — derive from the documented `side ?? border ?? "none"` rule:
- Empty `{}` → all four longhands `"none"`.
- `{ border: '1px solid red' }` → all four equal `'1px solid red'`.
- A per-side override (`{ border: 'none', borderTop: '2px dashed blue' }`) → only `borderTop` differs; the other three are `'none'`.
- Per-side with **no** `border` fallback (`{ borderLeft: '1px' }`) → `borderLeft: '1px'`, the other three `'none'`.
- Return shape is exactly the four keys `borderTop/borderRight/borderBottom/borderLeft` (assert with `toEqual` on the full object so extra/missing keys are caught).

`borderSideWidth` behaviours — derive from "leading `<n>px`, else 0":
- `undefined` / `''` / `'none'` / `'0'` / `'var(--x)'` → `0`.
- `'1px solid red'` → `1`; `'2.5px'` → `2.5` (decimal); leading/trailing whitespace tolerated (`'  3px solid'` → `3`).
- Case-insensitive unit (`'4PX'` → `4`, per the `/i` flag).
- A non-`px` unit (`'1em'`, `'1rem'`, `'10%'`) → `0` (only `px` counts).
- `'0px'` → `0`.

### `primitive/Point.ts` → `tests/unit/primitive/Point.test.ts`

`Point extends BaseObject`; importing it pulls in `BaseObject` — confirm during implementation that `~/core/BaseObject` has no DOM dependency (it shouldn't; if `new Point()` throws under the `node` env, surface it — a `node`-safe primitive that can't construct headless is itself a finding).

Behaviours — derive from the constructor's `x || 0` coalescing and the getters' `_v || 0`:
- `new Point(3, 4)` → `getX()` 3, `getY()` 4.
- `render()` → `'3 4'` (space-separated `"x y"`).
- **Falsy-coalescing quirk worth pinning:** because the field uses `x || 0`, `new Point(0, 0)` yields 0 (fine) but `new Point(NaN, 5)` coalesces `NaN` to `0`, and a *negative-zero* or any falsy input collapses to `0`. Most notable: this is `||`, not `??`, so a legitimately-`0` value is indistinguishable from "unset" — derive whether that matches the "two-dimensional point" contract and note it. There is **no** setter, so no mutation cases.

### `primitive/Size.ts` → `tests/unit/primitive/Size.test.ts`

`Size` is an interface (structural, no runtime). The runtime exports are `UNBOUNDED`, `isUnbounded`, `saturate`. Callers: the box/flow/grid layouts and `Component`.

Behaviours — derive from the "unbounded sentinel" JSDoc:
- `UNBOUNDED === Number.MAX_SAFE_INTEGER`.
- `isUnbounded(UNBOUNDED)` true; `isUnbounded(0)` / `isUnbounded(100)` false.
- **Legacy sentinel recognition** (explicitly documented): `isUnbounded(Number.MAX_VALUE)` is **true** (`MAX_VALUE > MAX_SAFE_INTEGER`). Pin this — it's a stated contract, easy to regress.
- `isUnbounded(Infinity)` true (follows from `>=`).
- `saturate(100)` → 100; `saturate(UNBOUNDED + anything)` caps at `UNBOUNDED`; `saturate(Number.MAX_VALUE)` → `UNBOUNDED` (the cap is the point — an unbounded sum must not overflow past it). `saturate(-5)` → `-5` (only an upper cap).

### `primitive/Position.ts`, `primitive/Placement.ts`, `primitive/BorderStyle.ts` → one spec file each under `tests/unit/primitive/`

These are enums. The behaviour worth pinning is the **member-to-value mapping** (renaming a value silently breaks CSS/serialization), derived from the source:
- **`Position`** — string enum: `STATIC === 'static'`, `FIXED === 'fixed'`, `ABSOLUTE === 'absolute'`. These strings are emitted as CSS `position` values, so the mapping is load-bearing.
- **`Placement`** — string enum: `CENTER === 'center'`, `NORTH === 'north'`, `SOUTH === 'south'`, `WEST === 'west'`, `EAST === 'east'`.
- **`BorderStyle`** — **numeric** enum (no explicit initializers), so members are `0..9` in declaration order: `NONE === 0`, `DOTTED === 1`, …, `HIDDEN === 9`. Pin at least `NONE === 0` and the last member `HIDDEN === 9` to lock the count and order; a reverse-mapping check (`BorderStyle[0] === 'NONE'`) documents that this is a numeric enum, not a string one. **Surface-it candidate:** the name `BorderStyle` and the JSDoc "standard CSS border-style keyword values" suggest these should map to the CSS keyword *strings* (`'none'`, `'dotted'`, …), yet the enum is numeric — if the implementer finds no consumer that converts the ordinal back to a keyword, flag the mismatch for the user rather than just asserting the ordinals.

### `primitive/Edge.ts`, `primitive/Axis.ts` → thin compile-time spec(s) under `tests/unit/primitive/`

Per the Architecture Decision: type-alias-only modules. One small spec each (or a single combined `primitive-types.test.ts`) that assigns valid members to typed `const`s — `const e: Edge = 'left'`, `const o: AxisOrientation = 'vertical'`, etc. — so the union membership is verified at compile time, with a trivial runtime `expect(e).toBe('left')` so the file is a real test. Do **not** fabricate runtime behaviour. If the implementer concludes these add no signal, note that in the report instead of padding the suite.

---

## Ordered Implementation Steps

1. **Confirm the harness.** Read [`vitest.config.ts`](../vitest.config.ts) and [`tests/unit/Insets.test.ts`](../tests/unit/Insets.test.ts) / [`tests/unit/data/proxy/MemoryProxy.test.ts`](../tests/unit/data/proxy/MemoryProxy.test.ts) to lock the import/`describe`/`it` style. → verify: `npx vitest run tests/unit/Insets.test.ts` passes before adding anything.
2. **Create `tests/unit/primitive/`.** Add the primitive specs: `Border.test.ts`, `Point.test.ts`, `Size.test.ts`, `Position.test.ts`, `Placement.test.ts`, `BorderStyle.test.ts`, and the thin `Edge`/`Axis` (or combined `primitive-types.test.ts`). For each, derive expected values from the contract **before** running (Architecture Decision step 1). → verify: `npx vitest run tests/unit/primitive` green, or a documented `it.fails`/surfaced divergence.
3. **Add `tests/unit/data/compareValues.test.ts`** covering the null/locale/date/native matrix above. → verify: `npx vitest run tests/unit/data/compareValues.test.ts`.
4. **Add `tests/unit/data/FilterDescriptor.test.ts`** covering all twelve descriptor types plus dual record access and recursion. → verify: targeted run.
5. **Add `tests/unit/data/proxy/Reader.test.ts`** and **`tests/unit/data/proxy/Writer.test.ts`**, building records via `Model` + `ModelRecord` as the sibling proxy tests do. → verify: targeted runs.
6. **Full suite + coverage.** → verify: `npx vitest run` all green (modulo intentionally-marked `it.fails`); optionally `npx vitest run --coverage` shows the eight primitive files and four data files now covered.
7. **Self-review against the Architecture Decision:** walk each new file and confirm no assertion was written by reading the code's output first. List every surfaced divergence in the implementation report.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `tests/unit/data/compareValues.test.ts` |
| Create | `tests/unit/data/FilterDescriptor.test.ts` |
| Create | `tests/unit/data/proxy/Reader.test.ts` |
| Create | `tests/unit/data/proxy/Writer.test.ts` |
| Create | `tests/unit/primitive/Border.test.ts` |
| Create | `tests/unit/primitive/Point.test.ts` |
| Create | `tests/unit/primitive/Size.test.ts` |
| Create | `tests/unit/primitive/Position.test.ts` |
| Create | `tests/unit/primitive/Placement.test.ts` |
| Create | `tests/unit/primitive/BorderStyle.test.ts` |
| Create | `tests/unit/primitive/Edge.test.ts` (or fold into `primitive-types.test.ts`) |
| Create | `tests/unit/primitive/Axis.test.ts` (or fold into `primitive-types.test.ts`) |

No source files are modified. (If a surfaced divergence turns out to be a code bug the user wants fixed, that is a follow-up plan — not this one.)

---

## Verification

- `npx vitest run` — entire suite green except any deliberately-marked `it.fails`/`it.todo` divergences, each with a comment explaining the contract it pins.
- `npx vitest run --coverage` — the twelve target source files (four data, eight primitive; the two type-alias modules contribute no executable lines) appear covered; no previously-green file regressed.
- `npx tsc --noEmit` (or the project's typecheck script) — the type-alias specs and all `~/...` imports compile.
- Each new spec runs standalone (`npx vitest run <file>`), confirming no hidden cross-file ordering dependency.

---

## Potential Challenges

- **Locale-dependent `localeCompare`.** Assert sign only, never magnitude, and avoid locale-fragile cases beyond the documented `'Ä'`-between-`'a'`-and-`'Z'` claim; if that case is itself locale-sensitive in CI, mark it and surface it rather than weakening it.
- **`Point` pulling in `BaseObject`.** If `BaseObject`'s module graph reaches the DOM, `new Point()` may fail under `node`; that is a finding to surface, not to paper over with a jsdom opt-in (the brief scopes these as no-DOM modules).
- **`undefined`-field relational filters** (`gt`/`lt` etc.) and the **`Point` `||`-coalescing** and **`BorderStyle` numeric-vs-keyword** points are the most likely genuine "expectation ≠ code" moments — the plan deliberately routes each through the surface-it protocol so they don't get silently normalised to green.
- **Empty `and`/`or`** vacuous truth values are correct set-theoretically but easy to mis-expect; derive them deliberately.

---

## Critical Files

- [`tests/unit/Insets.test.ts`](../tests/unit/Insets.test.ts) — primitive-test style to mirror.
- [`tests/unit/data/proxy/MemoryProxy.test.ts`](../tests/unit/data/proxy/MemoryProxy.test.ts) and [`tests/unit/data/proxy/AjaxProxy.test.ts`](../tests/unit/data/proxy/AjaxProxy.test.ts) — `Model`/`ModelRecord` construction, fetch-stub style, and the existing through-the-proxy Reader/Writer assertions that establish the contract.
- [`vitest.config.ts`](../vitest.config.ts) — `node` env default, `~/...` alias merge.
- [`src/typescript/lib/data/AbstractStore.ts:1739`](../src/typescript/lib/data/AbstractStore.ts#L1739) (`compareBySorter`) and [`StoreWorker.ts`](../src/typescript/lib/data/StoreWorker.ts) — the callers that fix `compareValues`/`matchesFilter` contracts (null-last under direction; dual record access).
- [`src/typescript/lib/data/Field.ts:10`](../src/typescript/lib/data/Field.ts#L10) — the `FieldType` union driving `compareValues`' type branches.

---

## Non-Goals

- **No DOM/Component tests.** Anything needing jsdom (`Insets` is already covered; component primitives that render) is out — this plan is the `node`-environment slice only.
- **No source-code changes.** Divergences are *surfaced*, not fixed here.
- **No new test infrastructure.** No custom matchers, fixtures, or helpers beyond what the existing suites use; reuse `Model`/`ModelRecord` directly.
- **No exhaustive enum/type fuzzing.** Pin the load-bearing member→value mappings, not every conceivable combination.
