# ESLint Setup — Implementation Plan

## Overview

Adopt ESLint as the project's static-analysis surface, scoped to one immediate goal: a custom rule that flags subclass constructors which take an `options` parameter but call `super()` without forwarding it.

That bug pattern has bitten this codebase twice within recent memory. Once for a Panel subclass — see [plans/implemented/support-super-options-from-subclasses.md](implemented/support-super-options-from-subclasses.md), where `ComplexUIPanel`'s `super({ layoutManager: ... })` was silently dropped by the leaf-only gate in `Panel.ts`. Once for [src/typescript/lib/component/list/MultiSelectList.ts](../src/typescript/lib/component/list/MultiSelectList.ts), where the demo's store-backed and items-backed lists rendered empty because the `items` / `store` options were dropped before reaching `ComboBox`'s constructor-body cascade at [src/typescript/lib/component/input/ComboBox.ts:66-106](../src/typescript/lib/component/input/ComboBox.ts#L66-L106). Both failed at runtime as "empty component," not as type errors.

The plan installs ESLint v9 with flat config, the `typescript-eslint` parser/plugin, and a single project-local rule — `forward-super-options` — defined inline in the flat config (no separate plugin package). One npm script wires it in. No CI changes; no broad lint sweep of the existing 172 lib files beyond what the one rule reports.

---

## Architecture Decisions

### Flat config (`eslint.config.js`), not `.eslintrc`

ESLint v9 is flat-config-only. Adopt that directly; don't carry over legacy `.eslintrc` shapes. The file lives at the project root next to [vite.config.ts](../vite.config.ts), exports a single config array, and runs without `parserOptions.project` — the custom rule is ESTree-only (no type information needed), so the faster project-less mode is sufficient.

### Local rule, not a separate plugin package

The `forward-super-options` rule is one ~40-line AST visitor. Defining it inline via the flat-config plugins API (`plugins: { local: { rules: { 'forward-super-options': … } } }`) keeps it in-repo, version-controlled with the rest of the config, and avoids the publishing dance of a sibling package. If a second rule appears later, extract to `scripts/eslint/local-plugin/` then.

### Conservative ruleset — no broad style sweep

Enable only:

- `typescript-eslint`'s `recommended` config for the floor (no-unused-vars, no-explicit-any, etc.) — and only if it lights up zero or near-zero violations across `src/`. If it surfaces a wall of pre-existing issues, drop it and run with just the custom rule until a separate cleanup pass.
- `local/forward-super-options` as the targeted custom rule.

Reject `airbnb`, `standard`, prettier-eslint integration, and similar packs. They'd flag thousands of stylistic violations across the existing 172 lib files and bury the one rule that matters. The project can adopt more rules incrementally if value materialises.

### Rule shape — zero-arg `super()` in a constructor that takes `options`

AST pattern:

1. `MethodDefinition[kind="constructor"]` inside a `ClassDeclaration` / `ClassExpression` with a `superClass`.
2. Whose `value.params` contains a parameter whose resolved name matches `/^opts?$|^options$/i` (covers `options`, `opts`, `Options`).
3. Whose body contains a top-level `ExpressionStatement > CallExpression[callee.type="Super"]` with `arguments.length === 0`.

If all three match: report on the `super()` call, message: `super() drops the constructor's "{{name}}" parameter — pass it explicitly: super({{name}}).`

**Not caught (intentional v1 scope):**

- `super({ tag: "select" })` with `options` referenced nowhere in the bag — still a likely bug, but needs name-resolution to catch reliably. False negative accepted; the smoke-test approach discussed alongside this rule covers it from the other side.
- Multi-overload TypeScript constructors (`constructor(...); constructor(...) { … }`). Overload signatures have no body, so the visitor's inner loop simply runs zero times — they're effectively skipped, which is correct.
- Subclasses that intentionally call `super()` to use parent defaults and then re-apply the options themselves via `this.applyOptions(options)`. The MultiSelectList bug is exactly this anti-pattern (cascade order matters); flagging it is the desired behaviour.

### No CI wiring (out of scope)

The `lint` script gives the rule a callable surface. Wiring `npm run lint` into a `.github/workflows/*.yml` step is a separate concern best handled when other quality gates (tests, `docs:build`) join CI together.

---

## File Layout

```
/eslint.config.js                                ← new flat config; declares the local plugin
/scripts/eslint/forward-super-options.js         ← rule implementation (JS, no build step)
/scripts/eslint/forward-super-options.test.mjs   ← rule unit test via RuleTester
```

No `tsconfig.eslint.json` — the rule walks ESTree only, not types.

The `scripts/` directory does not yet exist; this plan creates it.

---

## `eslint.config.js` shape

```js
import tseslint from 'typescript-eslint';
import forwardSuperOptions from './scripts/eslint/forward-super-options.js';

export default tseslint.config(
    { ignores: ['dist/**', 'node_modules/**', 'docs/.vitepress/cache/**'] },
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        plugins: {
            local: { rules: { 'forward-super-options': forwardSuperOptions } },
        },
        rules: {
            'local/forward-super-options': 'error',
        },
    },
);
```

## `scripts/eslint/forward-super-options.js` — visitor sketch

```js
const OPTIONS_NAME_RE = /^(opts?|options)$/i;

function paramName(p) {
    if (!p) return null;
    if (p.type === 'Identifier') return p.name;
    if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') return p.left.name;
    if (p.type === 'TSParameterProperty' && p.parameter.type === 'Identifier') return p.parameter.name;
    return null;
}

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Subclass constructors must forward their options parameter to super().' },
        schema: [],
        messages: {
            dropped: 'super() drops the constructor\'s "{{name}}" parameter — pass it explicitly: super({{name}}).',
        },
    },
    create(context) {
        return {
            'MethodDefinition[kind="constructor"]'(ctor) {
                const klass = ctor.parent.parent;
                if (!klass.superClass) return;

                const param = ctor.value.params.find(p => OPTIONS_NAME_RE.test(paramName(p) ?? ''));
                if (!param) return;
                const name = paramName(param);

                const body = ctor.value.body?.body ?? [];
                for (const stmt of body) {
                    if (stmt.type !== 'ExpressionStatement') continue;
                    const call = stmt.expression;
                    if (call.type !== 'CallExpression' || call.callee.type !== 'Super') continue;
                    if (call.arguments.length === 0) {
                        context.report({ node: call, messageId: 'dropped', data: { name } });
                    }
                    return; // only the first super() call matters
                }
            },
        };
    },
};
```

---

## Ordered Implementation Steps

### Step 1 — Install ESLint and parser

1. Add `eslint@^9` and `typescript-eslint@^8` to `devDependencies` (the umbrella `typescript-eslint` package pulls in `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`).
2. Add `"lint": "eslint src"` and `"lint:fix": "eslint src --fix"` to [package.json](../package.json) scripts.
3. Confirm `dist`, `node_modules`, and `docs/.vitepress/cache` are in the flat config's `ignores` array (no `.eslintignore` in v9).

### Step 2 — Write the rule

1. Create `scripts/eslint/forward-super-options.js` from the visitor sketch above. JavaScript, not TypeScript, so it runs without a build step.
2. Create `eslint.config.js` at project root from the flat config shape above.

### Step 3 — Verify the rule fires on the known-bug shape

The recent MultiSelectList fix means there's no current offender in `src/`. Confirm the rule fires by adding a focused unit test:

```js
// scripts/eslint/forward-super-options.test.mjs
import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import rule from './forward-super-options.js';

const tester = new RuleTester({ languageOptions: { parser: tsParser } });

tester.run('forward-super-options', rule, {
    valid: [
        'class C extends B { constructor(options?: X) { super(options); } }',
        'class C extends B { constructor() { super(); } }',                                  // no options param
        'class C { constructor(options?: X) { } }',                                          // no superclass
        'class C extends B { constructor(options?: X) { super({ ...options, tag: "div" }); } }',
    ],
    invalid: [{
        code:   'class C extends B { constructor(options?: X) { super(); } }',
        errors: [{ messageId: 'dropped' }],
    }],
});

console.log('forward-super-options: all tests passed.');
```

Wire as `"test:lint": "node scripts/eslint/forward-super-options.test.mjs"` in `package.json`.

### Step 4 — Run against the codebase, file follow-ups

1. `npm run lint` — should be clean given the MultiSelectList fix already landed. Any other offenders surface here.
2. Each report is a *suspected* silent-cascade bug, not a stylistic warning. Fix in the same PR if simple; otherwise open a follow-up.
3. Pre-existing `typescript-eslint` recommended-config violations (no-unused-vars, no-explicit-any, etc.) are out of scope. If the count is small, fix; if it's a wall, drop the recommended config from `eslint.config.js` for this round and run with just the custom rule.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `eslint.config.js` |
| Create | `scripts/eslint/forward-super-options.js` |
| Create | `scripts/eslint/forward-super-options.test.mjs` |
| Modify | `package.json` (add `eslint`, `typescript-eslint` devDeps; add `lint`, `lint:fix`, `test:lint` scripts) |

---

## Verification

1. `npm install` — succeeds; ESLint and `typescript-eslint` installed at the requested major versions.
2. `npm run test:lint` — RuleTester reports all valid/invalid cases pass.
3. `npm run lint` — exits 0 against current `src/` (assumes the MultiSelectList fix at [src/typescript/lib/component/list/MultiSelectList.ts](../src/typescript/lib/component/list/MultiSelectList.ts) is in place).
4. **Manual regression check**: on a scratch branch, change MultiSelectList's `super(options)` back to `super()`. Run `npm run lint`. Confirm the rule reports `forward-super-options` on that exact line. Discard the branch.
5. `npx tsc --noEmit` — unchanged from baseline; the rule is JS and doesn't affect type-checking.

---

## Potential Challenges

- **Parameter renamed `props` or `args`.** The current heuristic (`/^(opts?|options)$/i`) covers `options`, `opts`, `Options`. A subclass that names it `props` slips through. Document the convention in the rule's `meta.docs.description`; widen the regex only if real cases appear.

- **`super({ ...spread })` is treated as forwarding.** That's correct when the spread contains `options`; it's a false negative when the bag doesn't include it. v1 accepts this — the structural defence is the smoke test discussed alongside the rule, not lint.

- **First commit will show the recommended-config noise.** Step 4 mitigates: drop the recommended preset if the count is high, ship the custom rule alone, and revisit the broader cleanup as a separate PR.

---

## Critical Files

- [src/typescript/lib/component/input/ComboBox.ts:66-106](../src/typescript/lib/component/input/ComboBox.ts#L66-L106) — construction contract the rule enforces; documents the "subclass must call `super(options)` and dispatch late-built setters from the body" convention. Read first.
- [src/typescript/lib/core/Component.ts:213-270](../src/typescript/lib/core/Component.ts#L213-L270) — the `_options` bag mechanism the cascade writes to. Background context for why a dropped `super()` parameter is invisible at type-check time.
- [plans/implemented/support-super-options-from-subclasses.md](implemented/support-super-options-from-subclasses.md) — historical record of the same bug pattern in `Panel`/`Component`; the rule generalises that fix to the rest of the hierarchy (`ComboBox`, `List`, future ancestor classes).
- [plans/implemented/options-bag-state-refactor.md](implemented/options-bag-state-refactor.md) — the broader options-bag refactor that established the cascade convention. The rule is the static-analysis side of that work.

---

## Non-Goals

- **CI integration.** No GitHub Actions workflow change in this plan; the script is locally runnable. Wire it later alongside other quality gates (tests, `docs:build`).
- **Broad style enforcement.** No Prettier integration, no airbnb/standard configs, no import-order rules. The cost of fixing the 172-file diff outweighs near-term value.
- **A separate `eslint-plugin-typescript-ui` npm package.** Inline the rule in the flat config until a second rule justifies extraction.
- **Type-aware rules (`@typescript-eslint/strict-type-checked`).** They require `parserOptions.project` and add seconds-per-file overhead. Skip until a concrete need appears.
- **The wider "construct every component with every option" smoke test.** That's the structural fix discussed alongside this rule and belongs in its own plan if pursued — not in this lint plan.
