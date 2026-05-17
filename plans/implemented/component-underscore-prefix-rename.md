# Underscore-Prefix Rename for Private/Protected Fields — Implementation Plan

## Overview

Rename every `private` and `protected` instance field in `src/typescript/lib/` to carry a leading underscore (`_`) prefix. Public fields, static fields, and accessor (`getX`/`setX`) method names are out of scope.

The codebase has drifted into an inconsistent state. A handful of `Component` fields already follow the convention — `_willChange` at [src/typescript/lib/core/Component.ts:176](../src/typescript/lib/core/Component.ts#L176), `_aria` at [src/typescript/lib/core/Component.ts:189](../src/typescript/lib/core/Component.ts#L189), plus `_options`, `_defaultOptions`, and `_parent` — but the bulk do not: `components` at [src/typescript/lib/core/Component.ts:160](../src/typescript/lib/core/Component.ts#L160), `element` at [src/typescript/lib/core/Component.ts:162](../src/typescript/lib/core/Component.ts#L162), `tag` at [src/typescript/lib/core/Component.ts:163](../src/typescript/lib/core/Component.ts#L163), `left`/`top`/`width`/`height` at [src/typescript/lib/core/Component.ts:170-173](../src/typescript/lib/core/Component.ts#L170-L173), `border` at [src/typescript/lib/core/Component.ts:185](../src/typescript/lib/core/Component.ts#L185), `display` at [src/typescript/lib/core/Component.ts:191](../src/typescript/lib/core/Component.ts#L191), and dozens more in sibling files.

The same mixed state exists in subclasses: protected fields inherited from `Component` and added on classes like `Panel`, `Window`, `Table`, `List`, `Tab`, `ComboBox`, etc. Once renamed, the codebase enforces one universal rule — "leading `_` means non-public state" — and an ESLint guard (`@typescript-eslint/naming-convention`) keeps it that way.

---

## Architecture Decisions

### Scope — `private` and `protected`, not `public`, not `static`

Both visibility modifiers carry the same semantic: internal state the class owns and external callers should not touch. Prefixing both gives readers one cue ("starts with `_` → not for you") regardless of whether they're outside the class or inside a subclass. Public fields stay bare — they're part of the API surface and the prefix would be noise on a user-facing identifier. Static fields stay bare too: they're class-level constants/helpers, conceptually closer to module exports than instance state, and `Component.SOMETHING` reads cleanly without the underscore.

### Don't re-rename already-prefixed fields

`_options`, `_defaultOptions`, `_parent`, `_aria`, `_willChange` are already correct. The script must filter on `!name.startsWith('_')` before renaming so it leaves them alone (and so re-runs are idempotent).

### Public accessors keep their bare names

`getLeft()` / `setLeft(v)` stay as written. Only the backing field flips from `left` to `_left`. The setter body changes from `this.left = v` to `this._left = v`; the public method signature is untouched. This is critical for the `dist/*.d.ts` surface and for every external call site (including subpath barrels).

### Rename via TS symbol-rename, not text `sed`

A textual `sed -i 's/\.left/\._left/g'` is unsafe — `.left` appears on `Insets` literals ([src/typescript/lib/core/Component.ts:48-51](../src/typescript/lib/core/Component.ts#L48-L51)), on `DOMRect` reads, on CSS `transform-origin: left` strings, and on `Position` literals. A symbol-rename via `ts-morph` walks the AST, asks the type checker for the declaring symbol on every reference, and only rewrites references that resolve back to the renamed class member. Template-literal interpolations like `` `${this.tag}` `` are normal property accesses to the checker, so they're picked up too. False positives drop to zero.

### Driver script lives in `scripts/rename-private-fields.ts`

Written as a one-off — added to the repo for review, but not wired into `package.json`. After the rename ships and the ESLint rule is in place the script becomes dead weight; deleting it is a follow-up. JS or TS is fine; TS matches the existing `scripts/` style ([plans/eslint-setup.md](eslint-setup.md) introduces that directory).

### Pseudocode

```ts
// scripts/rename-private-fields.ts
import { Project, Scope, PropertyDeclaration } from 'ts-morph';

const project = new Project({ tsConfigFilePath: 'tsconfig.json' });
const bucket  = process.argv[2] ?? 'src/typescript/lib';

for (const sf of project.getSourceFiles(`${bucket}/**/*.ts`)) {
    for (const cls of sf.getClasses()) {
        for (const prop of cls.getInstanceProperties()) {
            if (!(prop instanceof PropertyDeclaration)) continue;
            const scope = prop.getScope();
            if (scope !== Scope.Private && scope !== Scope.Protected) continue;
            const name = prop.getName();
            if (name.startsWith('_')) continue;
            prop.rename(`_${name}`);   // ts-morph rewrites the declaration + every reference, all files
        }
    }
}

project.saveSync();
```

`rename()` from `ts-morph`'s `PropertyDeclaration` traverses every project source file the symbol is referenced from — including subclasses that read the protected field — so a single bucket-scoped run mutates files outside that bucket when it has to. That is the desired behaviour; it's why the script declaration-walks one bucket at a time but lets `ts-morph` decide which references to rewrite.

---

## Order of Operations

Run the script bucket by bucket, typechecking after each. Order follows the dependency chain — leaves of the import DAG first would be backwards because the symbol declarations the rename touches live in core. Going core-out means each subsequent bucket starts from a clean typecheck.

1. `core/` → `npm run typecheck`
2. `primitive/` → `npm run typecheck`
3. `validation/` → `npm run typecheck`
4. `data/` → `npm run typecheck`
5. `layout/` → `npm run typecheck`
6. `component/` → `npm run typecheck`
7. End-to-end: `npm run docs:build` — expect 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

Each bucket runs in its own commit. If a typecheck fails, the diff is small and reviewable; revert or fix forward before moving to the next bucket.

---

## ESLint Guard

Add to `eslint.config.mjs` (the flat config introduced by [plans/eslint-setup.md](eslint-setup.md) — coordinate landing order; this plan assumes that one has shipped first):

```js
'@typescript-eslint/naming-convention': ['error',
    {
        selector: 'classProperty',
        modifiers: ['private'],
        format: ['camelCase'],
        leadingUnderscore: 'require',
    },
    {
        selector: 'classProperty',
        modifiers: ['protected'],
        format: ['camelCase'],
        leadingUnderscore: 'require',
    },
],
```

The rule is from `@typescript-eslint/eslint-plugin`, already pulled in transitively by the `typescript-eslint` umbrella package the ESLint plan installs. Public class properties are not covered by these two selectors, so the rule does not force `_` on the public API surface. Static fields use a different `selector` (`'classProperty'` with `modifiers: ['static']` would be the negation — but the two rules above don't match static members because they require the access modifier, so static is implicitly excluded).

---

## Public-API Safety

Subpath barrels at `src/typescript/lib/<group>/index.ts` re-export classes and types, never private fields — there's nothing to rename on the export surface. TypeScript strips `private` and `protected` declarations from emitted `.d.ts` files by default, so `dist/typescript/lib/core/Component.d.ts` will not change. Consumers depending on the published `dist/` see zero diff.

The one wart: TS keeps `private` members visible in `.d.ts` when `--declaration` runs with `--isolatedDeclarations` or when the user opts in via `// @internal` filters. This project doesn't use either — confirmed by inspecting `tsconfig.json` before shipping. If that changes later, the rename is forward-compatible because all backing fields would simply gain a `_` in the emitted types.

---

## Risk List

- **String-keyed access (`this["fieldName"]`)** — bypasses the TS rename. Grep first: `grep -rn 'this\["' src/typescript/lib/` should return zero matches. (Verified at plan-write time: zero matches.)
- **`Object.keys(this)` or `Reflect.ownKeys(this)` reflection** — would expose renamed keys to consumers. Grep: `grep -rn 'Object\.keys(this)\|Reflect\.ownKeys(this)' src/typescript/lib/` — must be zero. (Verified at plan-write time: zero matches.)
- **Error / debug strings mentioning field names** — e.g. `throw new Error("layoutManager is null")`. The TS rename does not touch string literals. Decision: accept the drift on debug strings; their phrasing usually refers to the *concept* (layoutManager), not the *field* (`_layoutManager`). If any read as misleading, a follow-up pass fixes them.
- **Captured references (`const f = this.foo; f();`)** — bound captures are normal property reads; `ts-morph` rename handles them transparently.
- **JSON serialization** — none expected (no `JSON.stringify(this)` on Components). Confirm with `grep -rn 'JSON\.stringify(this)' src/typescript/lib/` before shipping; expect zero. If non-zero, every offender needs a hand-written `toJSON()` or a `pick` of the renamed keys.
- **External code in `examples/` or `docs/`** — if any example imports a `Component` and pokes a private field, the rename breaks it. Lib privates shouldn't be reachable from examples in practice; verify with a `tsc --noEmit` over the examples after the rename completes.
- **The `_` prefix collides with TS unused-variable convention.** Linters often treat a leading `_` as "intentionally unused." This is a parameter convention, not a field one — `@typescript-eslint/naming-convention` doesn't conflate them. Mention so reviewers don't flag false alarms.

---

## Ordered Implementation Steps

1. **Write `scripts/rename-private-fields.ts`** from the pseudocode above. Add `ts-morph` to `devDependencies` if not already present.
2. **Dry-run the script** with a `--dry-run` flag (log every intended rename, save nothing) on `src/typescript/lib/core` first. Eyeball the list — confirm it skips `_options`, `_defaultOptions`, `_parent`, `_aria`, `_willChange`, and confirm no public/static fields appear. → verify: list looks correct, no surprises.
3. **Run on `core/`** for real. → verify: `npm run typecheck` is clean.
4. **Run on `primitive/`**. → verify: typecheck clean.
5. **Run on `validation/`**. → verify: typecheck clean.
6. **Run on `data/`**. → verify: typecheck clean.
7. **Run on `layout/`**. → verify: typecheck clean.
8. **Run on `component/`**. → verify: typecheck clean.
9. **Add the `@typescript-eslint/naming-convention` block** to `eslint.config.mjs`. Run `npm run lint`. → verify: zero violations from these two selectors.
10. **`npm run docs:build`** → verify: 0 errors, 0 link warnings (typedoc-version notice excepted).
11. **`graphify update . --directed`** to refresh the knowledge graph (CLAUDE.md mandates this after any code mutation session).
12. **Manual smoke** at `http://localhost:8015` (`npm run dev`) — open the MiscPanel slow-table stress test and exercise drag, resize, scroll. → verify: same perf and interactivity as before.

---

## Files to Modify

| Action | File |
|---|---|
| Modify | Every `.ts` file under `src/typescript/lib/` (172 files at plan-write time — see `find src/typescript/lib -name '*.ts' \| wc -l`) — declarations and references mass-rewritten by the script |
| Create | `scripts/rename-private-fields.ts` (one-off driver, deletable after the rename ships) |
| Modify | `eslint.config.mjs` (or the canonical ESLint config path established by [plans/eslint-setup.md](eslint-setup.md)) — add the two `naming-convention` selectors |
| Modify | `package.json` — add `ts-morph` to `devDependencies` if not already present |

No changes to `docs/`, `examples/`, `src/resources/`, `tests/`, `vite.config.ts`, `tsconfig.json`, `typedoc.json`, or `typedoc-callable-plugin.mjs`.

---

## Verification

1. `npm run typecheck` — clean after each bucket and at the end.
2. `npm run docs:build` — 0 errors, 0 link warnings (typedoc-version notice excepted).
3. `npm run lint` — 0 violations on the two new `naming-convention` selectors, confirming the rename is total.
4. **Grep invariant**: `grep -rnE '^\s+(private|protected)\s+[a-zA-Z]' src/typescript/lib/ | grep -v ' _'` returns zero matches. Any hit is an unrenamed field — investigate and rerun the script with that bucket.
5. **Manual smoke** at `http://localhost:8015` — drag a window, resize, scroll the MiscPanel slow table, toggle theme. No regressions.
6. **`graphify update . --directed`** ran successfully; `graphify-out/GRAPH_REPORT.md` shows refreshed node count.

---

## Potential Challenges

See **Risk List** above. The headline gotcha is the textual-rename trap (`.left` on `Insets` vs. `this.left` the field), mitigated by the AST-based `ts-morph` approach.

A secondary gotcha worth flagging: `ts-morph`'s `rename()` can fail if a symbol with the target name already exists in the same scope. None should — all `_`-prefixed names are currently distinct from the bare names — but if a class declares both `foo` and `_foo` (extremely unlikely), the script will throw and the operator picks one to rename by hand.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — declares the largest set of private fields (lines 160-200ish). Read [src/typescript/lib/core/Component.ts:155-220](../src/typescript/lib/core/Component.ts#L155-L220) before running the script so the dry-run output is recognisable.
- `eslint.config.mjs` — destination for the `naming-convention` guard. Lands in [plans/eslint-setup.md](eslint-setup.md); coordinate sequencing.
- [CLAUDE.md](../CLAUDE.md) — "Surgical Changes" rule. This plan is a deliberate non-surgical rename across 172 files; explicit because the architectural-consistency win justifies the diff. Reviewer needs to know that going in.

---

## Non-Goals

- **Renaming public fields.** They're part of the API surface; underscoring them would be a breaking change for every consumer.
- **Renaming static fields.** They read as class-level constants and the prefix would be noise. The ESLint selectors above implicitly exclude statics.
- **Renaming accessor methods** (`getX` / `setX`). The backing field flips; the public method signature does not.
- **Touching `src/resources/`.** Vendored FontAwesome and bluebird assets — not our code, not in scope.
- **Touching `tests/`.** Tests exercise the public surface; if any test reaches into a private field, that's a separate bug the rename surfaces (it'll fail typecheck), not something this plan pre-fixes.
- **Renaming local variables, parameters, or function-scoped `let`/`const`.** Only class instance fields are in scope.
- **Refactoring nearby code while the script runs.** Surgical change: every diff line traces to the rename. Cleanup of unrelated drift is a separate plan.
