# Coding Guidelines

## Skills

Whenever a task matches a skill's description (see the available-skills list in your context), **invoke the named skill** instead of working freehand. The skill is the entry point; bypassing it loses the project-specific rules it enforces — and "freehand" includes the obvious traps: hand-writing plan markdown, editing source files straight from a plan, diving into a bug without the skill's heuristics, updating exported APIs without running the docs gate, or committing without the bucket/message rules. If a request even partially matches a skill description, invoke the skill first and let it decide scope.

## Architecture

Binding architectural rules live in [ARCHITECTURE.md](ARCHITECTURE.md). They are non-negotiable for every plan built and every code change written. Read the relevant section before producing a plan section or a code edit that touches that area; if a proposed change conflicts with a rule, raise it instead of silently working around it.

## Code conventions

Code style, formatting, and JSDoc rules live in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md). They are non-negotiable for every code change written. Read it (or recall it) **before writing or editing any TypeScript** — not just when explicitly asked about style. The most commonly tripped rule: every multi-line statement (braced `if`/`else`/`for`/`while`/`try`, multi-line initialisers, chained calls) is preceded **and** followed by a blank line, with exceptions for first/last/only statement in scope; back-to-back `if`-blocks without a blank between them is a violation. When unsure, cross-check against an adjacent method in the same file.

## Searching the code

Before reaching for `grep` on a code question, classify the query — there are three tools and three jobs, picked by query *shape*: known-string lookup → `grep`; cross-module / graph question ("what calls X") → **CodeGraph** (`codegraph query`, or `mcp__codegraph__*` when surfaced); structural-pattern audit ("every call shape matching `super($A, { ...$B })`") → **ast-grep**. The decision rule plus the concrete CLI cheat sheet live in [`.claude/skills/_shared/codegraph.md`](.claude/skills/_shared/codegraph.md). Default to `grep` only when the query is genuinely a string match — graph and structural questions are the cases where `grep` produces false positives or misses cross-file references entirely.

## Behavioral guidelines

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
- No abstractions for single-use code — unless extracting to a utility class clearly improves readability by separating reusable mechanics from call-site-specific writes.
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
