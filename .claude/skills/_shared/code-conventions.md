# Code Conventions

Shared reference: code style, JSDoc, and framework rules for any skill that writes TypeScript in this project.

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
