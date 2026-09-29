# Code Conventions

Project-specific conventions for this repo. **Extends the global, project-agnostic conventions in [`~/.claude/CODE_CONVENTIONS.md`](~/.claude/CODE_CONVENTIONS.md)** (code style, documentation comments, type annotations, magic-number documentation, function decomposition, plus a TypeScript/JavaScript notes section) — those apply here too; the rules below add to or specialise them for typescript-ui.

## Code Style

- **Construction:** configure components through the options bag at instantiation (`new Button({ text })`), not post-construction setters (`b.setText(text)`). Reserve `setX` for runtime changes after the component exists.

## Fields written during the `super()` cascade must use `declare`

A class-field initializer — `private _foo = false;` or `private _foo!: T;` — runs *after* `super()` returns. The base `Component` constructor invokes `applyOptions` from inside `super()`, before the subclass body runs, so any setter `applyOptions` dispatches executes during the cascade. If such a setter writes a field, the initializer that runs *afterward* silently reverts the write, and the value the consumer passed is lost.

The rule: **any field a cascade-dispatched setter writes must be declared bare with `declare`** — `declare private _foo: T;`, with no `= …` initializer and no `!` definite-assignment assertion. A `declare` field emits no constructor-time initialization, so the value the setter wrote during `super()` survives. Reach for `declare` whenever a field is touched by a setter `applyOptions` can dispatch — the common case being an `XOptions` field whose setter caches into a private backing field.

The complementary fix, for a field that genuinely needs a real initializer (a `ListenerBag` instance, say, which can't be left unconstructed), is to **defer the dispatch instead**: wire it from the constructor *body* (after `super()` returns), not from `applyOptions`. See the `listeners`-bag rule in [ARCHITECTURE.md](ARCHITECTURE.md) (Event handling) for that face of the same trap.

## Don't `{@link}` internal symbols from public JSDoc

The docs build (`npm run docs:api` → TypeDoc) excludes `private`, `protected`, and `@internal` members, as well as anything not re-exported from a package entry point. When a *public* (documented) symbol's JSDoc links to one of those excluded symbols — via `{@link Foo}` or `{@link Class.method}` — TypeDoc emits a *"links to X which was resolved but is not included in the documentation"* warning, because the generated page would point at a page that doesn't exist.

The rule: **the JSDoc of an exported symbol may only `{@link}` other symbols that appear in the public API docs** (exported, and not `private`/`protected`/`@internal`). To reference internal mechanics, **describe the behaviour in prose** instead of naming the symbol — e.g. write "derived live from the content row + perimeter" rather than "derived via `{@link computePreferredSize}`". The link inside an internal symbol's own JSDoc is fine; the constraint is only on docs that actually render.

**The standing bar.** `npm run docs:api` finishes with **zero** warnings, on
every branch. As of `docs-api-warning-clearance` that is the measured state
of `master`, so any warning is a regression introduced by the branch that
shows it. An implementation plan must not restate this bar and must never
write a weaker one — "no new warnings" and "no warnings against the base
branch" are both dead phrasings.

**Cross-module member links need the module qualifier.** An unqualified
`{@link Class.member}` resolves only from inside the class's own TypeDoc
module — from any other module it renders as dead plain text and warns, even
though the member is documented. Use the module-qualified form with a
display alias instead:

| `{@link …}` written in `validation/FieldDecorator.ts` | Rendered result |
|---|---|
| `Component.replaceComponent` | `Component.replaceComponent` — plain text, 1 warning |
| `Component!Component.replaceComponent` | links to the class page, **no member anchor** |
| `core!Component.replaceComponent` | `[core!Component.replaceComponent](…/Component.md#replacecomponent)` — right target, raw link text |
| `core!Component.replaceComponent \| Component.replaceComponent` | `[Component.replaceComponent](…/Component.md#replacecomponent)` — **use this** |

**Never silence a warning.** Adding an `externalSymbolLinkMappings` entry, an
`@internal` tag, or a `private` modifier to clear a docs warning is
prohibited: it removes the message, not the dead reference the reader lands
on. `typedoc.json`'s three existing `"#"` mappings predate this rule; they
hide three *type-reference* warnings of a different kind — a public
signature exposing a type never re-exported from its module's entry point —
and are tracked on the post-campaign agenda.

## Framework rules

Architectural rules (event handling, one-DOM-element-per-class, typed setters, render-time deferral, …) live in the root [ARCHITECTURE.md](ARCHITECTURE.md). They apply to every plan and every code change.
