# Code Conventions

Project-wide reference: code style, JSDoc, and framework rules. Applies to every TypeScript change in this repo.

## Code Style

- **Formatting:** blank lines between logical groups in a method body. Always brace `if`/`else`/`for`. Any multi-line expression or statement (whose source spans two or more lines — `if`/`else`, `for`/`while`/`do`, `switch`, `try`/`catch`, multi-line variable initialisers, chained call expressions broken across lines, etc.) must be preceded and followed by a blank line, with these exceptions: no preceding blank line if it is the first statement in its scope; no following blank line if it is the last statement in its scope; no blank lines at all if it is the only statement in its scope. Blank line before every `return`, unless it is the only statement in its scope. Blank line after a mutating call that ends a logical operation. One statement per line — never `a.setX(1); a.setY(2);`.
- **Construction:** configure components through the options bag at instantiation (`new Button({ text })`), not post-construction setters (`b.setText(text)`). Reserve `setX` for runtime changes after the component exists.
- **Functions:** arrow functions for callbacks instead of `.bind(this)`; explicit param types when the target signature is `Function`.
- **Types:** explicit return type on every function/method (including `void`); explicit type on every class field.
- **Naming collisions:** underscore-prefix backing fields (`private _foo`).

## Fields written during the `super()` cascade must use `declare`

A class-field initializer — `private _foo = false;` or `private _foo!: T;` — runs *after* `super()` returns. The base `Component` constructor invokes `applyOptions` from inside `super()`, before the subclass body runs, so any setter `applyOptions` dispatches executes during the cascade. If such a setter writes a field, the initializer that runs *afterward* silently reverts the write, and the value the consumer passed is lost.

The rule: **any field a cascade-dispatched setter writes must be declared bare with `declare`** — `declare private _foo: T;`, with no `= …` initializer and no `!` definite-assignment assertion. A `declare` field emits no constructor-time initialization, so the value the setter wrote during `super()` survives. Reach for `declare` whenever a field is touched by a setter `applyOptions` can dispatch — the common case being an `XOptions` field whose setter caches into a private backing field.

The complementary fix, for a field that genuinely needs a real initializer (a `ListenerBag` instance, say, which can't be left unconstructed), is to **defer the dispatch instead**: wire it from the constructor *body* (after `super()` returns), not from `applyOptions`. See the `listeners`-bag rule in [ARCHITECTURE.md](ARCHITECTURE.md) (Event handling) for that face of the same trap.

## JSDoc

Every function, method, and class needs a JSDoc block:
- Multi-line `/** … */`. Description first, blank line, then tags.
- `@param <name> - <desc>` (no type — TS has it). `@returns <desc>` for non-void. `@remarks` / `@example` only when behaviour is non-obvious.
- Tags flow consecutively, no blank lines between.
- Each overload gets its own JSDoc block.

## Magic numbers must be documented

Every literal numeric value in code — pixel sizes, durations, timeouts, retry counts, weights, ratios, thresholds — must be documented with **both**:

1. **What it represents.** Prefer extracting to a named `const` whose name carries the meaning (`STATUS_BAR_HEIGHT`, `DEFAULT_DEBOUNCE_MS`). When the value stays inline, the comment must say what it is.
2. **Why it's hardcoded.** A comment explaining the constraint that produced the number — the spec it tracks, the related theme token it mirrors, the empirical tuning behind it, or why a derived value isn't possible here. "Why this number and not another, and why isn't it computed."

The name covers the "what"; the comment covers the "why," which is the part that rots silently when the constraint shifts. If you can't articulate the "why," the number is probably wrong — find the constraint first.

## Decompose large or complex functions

A function that grows long or branches deeply must be split into named sub-functions. The caller becomes a short summary of its work; each callee owns one nameable step. Reviewers should grasp the top-level flow without reading every line of every branch.

Split when any of these hold:

- The body spans more than ~30 lines of substantive code (excluding JSDoc and braces-only lines).
- The body contains multiple distinct phases that each summarise to a noun or verb phrase (`collectVisibleRows`, `validateInput`, `flushPendingMeasurements`).
- A `switch` or `if`/`else` ladder has branches exceeding a few lines each — each branch becomes its own function.
- The function mixes abstraction levels — high-level orchestration interleaved with low-level DOM/string fiddling.

The name is the test. A sub-function called `handleX`, `doStep1`, or `processIt` defeats the purpose — names must read like a phrase a reviewer would write in the margin. If you can't name the piece, it isn't a piece; keep refactoring until each extracted function has an obvious noun- or verb-phrase name.

**Don't split for its own sake.** A 20-line function with one clear phase stays as one function. Extraction is for *readability*, not for hitting a line count. Sub-functions used by one caller in one file stay `private` — don't widen the API surface just because they exist.

## Framework rules

Architectural rules (event handling, one-DOM-element-per-class, typed setters, render-time deferral, …) live in the root [ARCHITECTURE.md](ARCHITECTURE.md). They apply to every plan and every code change.
