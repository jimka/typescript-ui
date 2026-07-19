# Coding Guidelines

- **Library capability index: [`packages/lib/llms.txt`](packages/lib/llms.txt) — read before building any UI feature**, so you use existing components/layouts instead of reinventing them.
- When producing implementation plans, **ALWAYS** use the plan skill.
- When implementing implementation plans, **ALWAYS** use the implement skill.
- When documenting code, **ALWAYS** use the document skill.
- When debugging code, **ALWAYS** use the debug skill.
- When reviewing, auditing, or critiquing a plan, code change, or any other target, **ALWAYS** use the audit skill.
- When committing changes, **ALWAYS** use the commit skill (it defines the message format — e.g. no `Co-Authored-By:` or "Generated with" trailers).
- When writing code, editing code, or planning future code, **ALWAYS** follow the architectural guidelines defined in [ARCHITECTURE.md](ARCHITECTURE.md) and the code conventions defined in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).

# Behavioral guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code — unless extracting to a utility class clearly improves readability by separating reusable mechanics from call-site-specific writes.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

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

## 4. Goal-Driven Execution

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

## 5. Steps to avoid post-change problems

- When debugging, Perform a root-cause investigation (reading the actual call chain for example) before trying to fix problems.
- Explicitly enumerate call sites and edge cases before editing, or verify with type-checks/tests after refactors, to prevent regressions.
- Write a self-review checklist and walk through it, or perform an explicit testing step before declaring done. This would reduce incomplete first-pass implementations.
