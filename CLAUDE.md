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

## Code formatting

Separate logical groups of statements within a method body with blank lines. Always use braces for `if`/`else`/`for` blocks — no single-line braceless forms. Blank line before a `return` that is not the very first statement in the block. Blank line after a mutating call that ends a logical operation (e.g. `container.setColumnWidths(...)`).

Never write multiple statements or expressions on the same line. Each statement must be on its own line:
```
// Never
a.setX(1); a.setY(2);

// Always
a.setX(1);
a.setY(2);
```

---

## Code Style

- Use arrow functions instead of .bind(this) for callbacks; include explicit parameter types when the target signature is `Function`
- Prefer separation of concerns: keep presentation/UI state out of data Models
- Use JSDoc in multi-line format (not single-line) for all exported APIs
- For TypeScript class member name collisions, use the underscore-prefix idiom for private backing fields

---

## Minimize direct DOM access

Direct DOM manipulation (e.g. `element.style.xxx`, `document.createElement`, native `addEventListener`) should be kept to an absolute minimum. Prefer the framework's Component setter/getter API and the `Event` class for all interactions that the framework already covers.

Before reaching for `element.style` or `document.createElement`, check whether a Component setter (`setWidth`, `setBackgroundColor`, `setPosition`, etc.) covers the need. Use raw DOM only for things the framework has no API for (e.g. the resize-handle `<div>` that lives inside a `<th>` and is not a full Component).

---

## Use the Event class for event handling

All component-level event listeners must go through `Event.addListener` / `Event.addViewportListener` rather than native `addEventListener`. Native listeners are acceptable only on raw DOM elements that are not `Component` instances (e.g. a raw helper `<div>`).

For any `Component` subclass, use `Event.addListener(this, type, handler)`. Reserve `element.addEventListener` for raw DOM helper elements that have no Component wrapper.

---

## One DOM element per class (separation of concerns)

A framework class should own and manage exactly one DOM element. Do not create or append sibling or wrapper elements from within a component's `render()`/`init()` methods beyond what that single element requires. If a visual sub-element needs independent behaviour, it should be its own `Component` subclass — unless it is a trivial non-interactive helper (such as a resize handle div) that has no independent identity.

Before appending a raw DOM child in `init()`, ask whether it warrants a full Component. If it does (e.g. needs event routing, its own CSS rule, or layout), extract it into a Component subclass.

---

## Always declare return types and class variable types explicitly

Every function and method must have an explicit return type annotation, including `void`. Every class variable (property) must have an explicit type declaration.

```typescript
// Never
getName() {
    return this.name;
}

private items = [];

// Always
getName(): string {
    return this.name;
}

private items: Item[] = [];
```

---

## Every function and method must have a JSDoc docstring

All functions, methods, and classes must have a JSDoc comment. Format:
- Opening `/**`, each line prefixed with ` *`, closing ` */`
- Description first, then a blank line before the first tag
- `@param <name> - <description>` (no type annotation — TypeScript already has the type)
- `@returns <description>` for non-void returns
- `@remarks` for extended explanation that does not belong in the main description
- `@example` with a fenced ` ```typescript ` block for usage examples on complex APIs
- Tags are not separated by blank lines; they flow consecutively
- For overloaded signatures, each overload gets its own separate JSDoc block

```typescript
/**
 * Returns the unique identifier for this object.
 *
 * @returns The UUID string assigned at construction time.
 */
getId() {
    return this.id;
}

/**
 * Adjusts the window's position and size based on the dragged border direction.
 *
 * @param border - The border handle that triggered the resize.
 * @param e - The mouse event carrying the movement delta.
 */
onResize(border: WindowBorder, e: MouseEvent) {
```

Keep descriptions concise — one sentence is often enough. Only add `@remarks` or `@example` when the API has non-obvious behaviour or complex usage.

---

## CSS manipulation via setter/getter methods

All CSS changes must go through the Component's setter/getter API (`setBackgroundColor`, `setWidth`, `setBorder`, `setPosition`, etc.) rather than by writing to `element.style` directly. This allows `Component.ts` to batch-commit style changes via the `setAutoCommitStyle(false)` / `setAutoCommitStyle(true)` pattern when needed.

If the needed property has no setter yet, add one rather than writing inline styles. Exception: properties on raw DOM helper elements (non-Component `<div>`s) may use `element.style` directly since they are not part of the Component style system.

## Debugging Approach

- Before pursuing CSS-based fixes for layout/sizing issues, first check for explicit size constraints (setMaxSize, setPreferredSize, fixed toolbar heights) that may be the root cause
- Always append 'px' units to numeric DOM style values
- For slow rendering, profile for O(N²) lookups (e.g., CSS insertRule) and live-DOM mutation overhead before optimizing elsewhere

---

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
