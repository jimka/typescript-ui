# Code Conventions

Project-wide reference: code style, JSDoc, and framework rules. Applies to every TypeScript change in this repo.

## Code Style

- **Formatting:** blank lines between logical groups in a method body. Always brace `if`/`else`/`for`. Any multi-line expression or statement (whose source spans two or more lines — `if`/`else`, `for`/`while`/`do`, `switch`, `try`/`catch`, multi-line variable initialisers, chained call expressions broken across lines, etc.) must be preceded and followed by a blank line, with these exceptions: no preceding blank line if it is the first statement in its scope; no following blank line if it is the last statement in its scope; no blank lines at all if it is the only statement in its scope. Blank line before every `return`, unless it is the only statement in its scope. Blank line after a mutating call that ends a logical operation. One statement per line — never `a.setX(1); a.setY(2);`.
- **Functions:** arrow functions for callbacks instead of `.bind(this)`; explicit param types when the target signature is `Function`.
- **Types:** explicit return type on every function/method (including `void`); explicit type on every class field.
- **Naming collisions:** underscore-prefix backing fields (`private _foo`).
- **Separation:** keep presentation/UI state out of data Models.

## JSDoc

Every function, method, and class needs a JSDoc block:
- Multi-line `/** … */`. Description first, blank line, then tags.
- `@param <name> - <desc>` (no type — TS has it). `@returns <desc>` for non-void. `@remarks` / `@example` only when behaviour is non-obvious.
- Tags flow consecutively, no blank lines between.
- Each overload gets its own JSDoc block.

## Framework rules

Architectural rules (event handling, one-DOM-element-per-class, typed setters, render-time deferral, …) live in the root [ARCHITECTURE.md](ARCHITECTURE.md). They apply to every plan and every code change.
