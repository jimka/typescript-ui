# Coding Guidelines

## Implementation Workflow

- After making multi-file changes, always trigger doLayout() or equivalent re-render hooks where applicable
- When refactoring, verify no regressions in dependent components (e.g., setBorder with no args should preserve, not clear)
- Before declaring a fix complete, mentally trace the inheritance chain and check sibling/dependent components

---

## Behavioral guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

### 5. Steps to avoid post-change problems

- When debugging, Perform a root-cause investigation (reading the actual call chain for example) before trying to fix problems.
- Explicitly enumerate call sites and edge cases before editing, or verify with type-checks/tests after refactors, to prevent regressions.
- Write a self-review checklist and walk through it, or perform an explicit testing step before declaring done. This would reduce incomplete first-pass implementations.


---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Debugging Approach

- Before pursuing CSS-based fixes for layout/sizing issues, first check for explicit size constraints (setMaxSize, setPreferredSize, fixed toolbar heights) that may be the root cause
- Always append 'px' units to numeric DOM style values
- For slow rendering, profile for O(N²) lookups (e.g., CSS insertRule) and live-DOM mutation overhead before optimizing elsewhere

---

## Documentation

The library has subpath-only exports — every public symbol lives in exactly one of `core`, `primitive`, `layout`, `data`, `validation`, `component/<sub>`. There is no root barrel.

JSDoc references across files:

- **Same-bucket reference** (target lives in the same subpath as the JSDoc you're writing): use `{@link Foo}`. TypeDoc resolves it.
- **Cross-bucket reference** (e.g. mentioning `Window` from `component/display`): use a markdown link to the API page — `[\`Foo\`](/api/<subpath>/<kind>/Foo)`. `{@link}` only sees symbols inside the same entry-point bundle, so cross-bucket references render as plain text and surface as docs:build warnings.
- **Self-reference** (a class's own JSDoc mentioning its own name): leave as bare backticks. Don't link to the page the reader is already on.
- **Name-collision symbols** (`Border`, `Body`, `Column`, `Header`, `Row`): always spell out the full subpath in the link so it goes to the right class.

TypeDoc entry points live in [typedoc.json](typedoc.json) — one per subpath barrel. The custom [typedoc-callable-plugin.mjs](typedoc-callable-plugin.mjs) promotes `callable()`-wrapped exports (`export { ButtonCallable as Button }`) from `/api/<bucket>/variables/X.md` back to `/api/<bucket>/classes/X.md` so the rendered API page carries the full class documentation. The plugin is automatic — new callable classes are picked up without configuration as long as the export form is `callable(_Inner)` with a real class on the inside.

After any change that affects the public API surface or symbol locations, run `npm run docs:build` and confirm **0 errors and 0 link warnings** (the lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice).

---

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
