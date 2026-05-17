---
name: implement
description: Implement a pre-generated implementation plan. Use when the user asks to implement an implementation plan and that plan exists in the {workspace}/plans folder
---

## Code Style

- **Formatting:** blank lines between logical groups in a method body. Always brace `if`/`else`/`for`. Blank line before a non-leading `return`. Blank line after a mutating call that ends a logical operation. One statement per line — never `a.setX(1); a.setY(2);`.
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

### Event handling
Component listeners go through `Event.addListener(this, type, handler)` / `Event.addViewportListener`. Native `addEventListener` only on raw DOM helper elements that aren't `Component`s.

### One DOM element per class
A class owns exactly one DOM element. If a sub-element needs independent behaviour (event routing, its own CSS rule, layout), extract it into a `Component` subclass. Trivial non-interactive helpers (e.g. a resize-handle div) can stay as raw children.

### Minimize direct DOM access
Before `element.style.*`, `document.createElement`, or `element.addEventListener`, check for a Component setter or `Event` API. Raw DOM is for things the framework has no API for.

### All attributes and styles go through typed setters

| Category | Use |
|---|---|
| CSS | Component setters (`setBackgroundColor`, `setWidth`, …) — add one if missing |
| ARIA / `role` / `tabindex` | `this.getAria()`; extend `Aria.ts` if missing |
| HTML attribute on every Component | typed setter in `Component.ts` |
| HTML attribute specific to one component | private field + typed setter on that class; calls `setElementAttribute` internally |

Never call `element.setAttribute(...)` or `element.style.*` directly from component code.

### Three non-negotiable rules for every DOM write

These apply to **every** use of the escape hatches — `setElementCSSRule(s)`, `setElementStyle(s)`, `setElementAttribute`, `removeElementAttribute`, and their `clear*` / `remove*` companions:

1. **Always through a typed setter.** No call site outside the typed setter (or its `clearX` / `removeX`) may touch the low-level API. Constructors route through the setter too. Add the setter if it doesn't exist.
2. **Always cache in a class field.** Every DOM write updates a private backing field; reads return the field, never re-query the DOM.
3. **Always expose on the `XOptions` bag.** The class's options interface gets a matching optional field; `applyOptions()` forwards it to the setter. Construction-time and post-construction APIs stay in lockstep.

```typescript
export interface FooOptions extends ComponentOptions {
    lineHeight?: number | string;
}

private _lineHeight: string | null = null;

setLineHeight(value: number | string): this {
    this._lineHeight = typeof value === "number" ? value + "px" : value;
    this.setElementCSSRule("lineHeight", this._lineHeight);
    return this;
}

getLineHeight(): string | null {
    return this._lineHeight;
}

protected applyOptions(options: FooOptions): this {
    super.applyOptions(options);

    if (options.lineHeight !== undefined) {
        this.setLineHeight(options.lineHeight);
    }

    return this;
}
```

### Defer DOM work to render time

Construction must stay JS-only. Every framework primitive buffers DOM writes until first render — keep them queued:

- **Component CSS rule**: `setElementCSSRule(s)` queues into `styleRule`; `applyStyle` flushes at render. Never call `ensureCSSRule()` from a setter.
- **State rules** (`:active`, `:hover`, `.selected`, …): allocate via `this.createStyleRule(suffix)`. The builder dedupes by suffix and registers for render-time materialisation. Never `new StyleRule(...)` directly.
- **Inline styles**: `setElementStyle(s)` queues into `inlineStyle`; `init()` attaches and flushes.
- **Measurement**: never read layout (`getBoundingClientRect`, `getComputedStyle`) during construction. Defer to a layout pass or theme-change callback.
- **Children**: build child Components in the constructor; their DOM is realised when the parent renders. Don't `getElement(true)` during construction.

## Documentation updates

When implementation changes consumer-visible behaviour, update `docs/`:

- **New public symbol** (class/type/enum/function): re-export from the per-subpath barrel (`core`, `primitive`, `layout`, `data`, `validation`, `component/<sub>` — no root barrel). Add `@category` (Core / Components / Layouts / Data / Theme / Validation / Util). Verify it lands in `docs/api/<group>/index.md` after build.
- **New component / layout / data class:** add a curated page under `docs/<group>/`, link it in `docs/.vitepress/config.mts`, add it to that group's `index.md` catalog.
- **New recipe-worthy pattern:** page under `docs/recipes/`, linked in sidebar and `docs/recipes/index.md`.
- **Consumer-visible behaviour change:** update matching `docs/concepts/` page; touch `docs/reference/faq.md` / `troubleshooting.md` if relevant.

Run `npm run docs:build` and confirm **0 errors and 0 link warnings** (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).

### JSDoc cross-bucket references

TypeDoc emits one entry-point bundle per subpath, so `{@link Foo}` only resolves within the same bucket.

| Target | Form |
|---|---|
| Same file or bucket | `{@link Foo}` |
| Different bucket | `[\`Foo\`](/api/<subpath>/<kind>/Foo)` |
| Class referencing itself | plain backticks `` `Foo` `` |

Subpath kinds: `classes`, `interfaces`, `enumerations`, `type-aliases`, `variables`, `functions`. For colliding names (`Border`, `Body`, `Column`, `Header`, `Row`), spell out the subpath in the link.

### typedoc-callable-plugin

Classes exported as `export { XCallable as X }` (where `const X = callable(_X)`) are auto-promoted from `variables/` to `classes/` by `typedoc-callable-plugin.mjs`. No setup needed. If a new class lands under `variables/` after build, verify: export form is `XCallable as X`, inner `_X` is a real `class` declaration, wrapping call is literally `callable(...)`.

## Git workflow

- **No author / co-author attribution.** No `Co-Authored-By:` trailer, no "Generated with …" line. Authorship is in the git fields, not the message.
- **At least three commits, by concern, in order:**
  1. **Code** — `src/**`, plan-file move from `plans/` to `plans/implemented/`, demo-panel updates. May be split into focused slices.
  2. **Documentation** — `docs/**` curated pages, changelog, migration notes. Auto-generated `docs/api/**` only if manually edited.
  3. **Graphify** — `graphify-out/**` from `graphify update . --directed`. Always its own commit.
- **Do not merge or rebase onto a base branch.** Leave for the user.
- **Do not push.** User publishes.

## Work Instructions

1. Read the referenced plan in `{workspace}/plans/`.
2. Check the codebase for incompatibilities with the plan (renamed/removed APIs, signature changes, file moves, broken assumptions). Update the plan in place to reflect current reality and save it.
3. If incompatibilities were found, stop and ask the user to review before continuing.
4. If on `master`, create and check out `feature/<short-feature-slug>`. Otherwise stay on the current branch.
5. Implement.
6. Extend demo panel(s) where applicable.
7. Move the plan to `{workspace}/plans/implemented/`.
8. Update `docs/` per _Documentation updates_.
