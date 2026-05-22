# Architecture Guidelines

Binding architectural rules for the framework. Every implementation plan (built via the `plan` skill) and every code change (executed via the `implement` skill, or written directly) must adhere to these.

## Event handling

Component listeners go through `Event.addListener(this, type, handler)` / `Event.addViewportListener`. Native `addEventListener` only on raw DOM helper elements that aren't `Component`s.

## One DOM element per class

A class owns exactly one DOM element. If a sub-element needs independent behaviour (event routing, its own CSS rule, layout), extract it into a `Component` subclass. Trivial non-interactive helpers (e.g. a resize-handle div) can stay as raw children.

## Minimize direct DOM access

Before `element.style.*`, `document.createElement`, or `element.addEventListener`, check for a Component setter or `Event` API. Raw DOM is for things the framework has no API for.

## All attributes and styles go through typed setters

| Category | Use |
|---|---|
| CSS | Component setters (`setBackgroundColor`, `setWidth`, …) — add one if missing |
| ARIA / `role` / `tabindex` | `this.getAria()`; extend `Aria.ts` if missing |
| HTML attribute on every Component | typed setter in `Component.ts` |
| HTML attribute specific to one component | private field + typed setter on that class; calls `setElementAttribute` internally |

Never call `element.setAttribute(...)` or `element.style.*` directly from component code.

## Three non-negotiable rules for every DOM write

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

## CSS writes go through `StyleRule` / `InlineStyle`

Never assign to `CSSStyleRule.style` or `HTMLElement.style` directly — no `rule.style.cssText = …`, no `rule.style.setProperty(…)`, no `element.style.width = …`, no `Object.assign(style, …)`. The framework owns two deferred-write buffers in [core/StyleTarget.ts](src/typescript/lib/core/StyleTarget.ts):

| Target | Class | Used by |
|---|---|---|
| `CSSStyleRule` (any selector — `#id`, `.class`, `:hover`, …) | `StyleRule` | Component rule, state rules, shared class rules |
| `HTMLElement.style` (inline) | `InlineStyle` | `setElementStyle(s)` |

Both buffer writes into a dirty bag until the target materialises, then flush via camelCase property assignment. Going through the buffer keeps construction-time writes safe (queued before element/rule exists), keeps theme-toggle re-flushes intact, and gives logging/audits a single seam.

For a module-level shared class rule, the canonical pattern is:

```typescript
const rule = new StyleRule(() =>
    (CSS.getClassRule(name) ?? CSS.createClassRule(name)) as CSSStyleRule);

rule.setMany({ position: "absolute", top: "0", /* … */ });
rule.ensure();
```

If you find yourself reaching for `.style.X` on a `CSSStyleRule` or `HTMLElement`, stop — there is a `StyleRule` / `InlineStyle` (or a Component setter that wraps one) that should own that write.

## Defer DOM work to render time

Construction must stay JS-only. Every framework primitive buffers DOM writes until first render — keep them queued:

- **Component CSS rule**: `setElementCSSRule(s)` queues into `styleRule`; `applyStyle` flushes at render. Never call `ensureCSSRule()` from a setter.
- **Per-component state rules** (`:active`, `:hover`, `.selected`, …): allocate via `this.createStyleRule(suffix)`. The builder dedupes by suffix and registers for render-time materialisation. Don't construct a `StyleRule` directly for these — go through `createStyleRule` so the dedupe + register path runs.
- **Module-level shared class rules** (`.SortPriorityBadge`, `.ResizeHandle`, …): `new StyleRule(() => CSS.getClassRule(name) ?? CSS.createClassRule(name)!)` inside a module-singleton `ensureXClassRule()` is the correct path; the `StyleRule` buffer is the public seam over `CSSStyleRule.style`.
- **Inline styles**: `setElementStyle(s)` queues into `inlineStyle`; `init()` attaches and flushes.
- **Measurement**: never read layout (`getBoundingClientRect`, `getComputedStyle`) during construction. Defer to a layout pass or theme-change callback.
- **Children**: build child Components in the constructor; their DOM is realised when the parent renders. Don't `getElement(true)` during construction.

## Magic numbers must be documented

Every literal numeric value in code — pixel sizes, durations, timeouts, retry counts, weights, ratios, thresholds — must be documented with **both**:

1. **What it represents.** Prefer extracting to a named `const` whose name carries the meaning (`STATUS_BAR_HEIGHT`, `DEFAULT_DEBOUNCE_MS`). When the value stays inline, the comment must say what it is.
2. **Why it's hardcoded.** A comment explaining the constraint that produced the number — the spec it tracks, the related theme token it mirrors, the empirical tuning behind it, or why a derived value isn't possible here. "Why this number and not another, and why isn't it computed."

The name covers the "what"; the comment covers the "why," which is the part that rots silently when the constraint shifts. If you can't articulate the "why," the number is probably wrong — find the constraint first.

## Components are exported through `callable()`

Every `Component` subclass must be wrapped with `callable()` before export. The raw class stays available behind an underscored alias purely as a typing escape hatch; the callable form is the public name.

```typescript
class StatusBar extends Panel<StatusBarOptions> { /* ... */ }

const StatusBarCallable = callable(StatusBar);
type StatusBarCallable = StatusBar;
export {
    StatusBar         as _StatusBar,
    StatusBarCallable as StatusBar,
};
```

Callable wrapping lets call sites write `StatusBar({ message: "Ready" })` and `new StatusBar({ … })` interchangeably, keeping component construction at parity with the framework's factory-style API.

**Imports always use the callable name.** Write `import { Panel } from "~/core/Panel.js"`, never `_Panel`. This holds even for `extends` clauses — the callable preserves the prototype chain, so `class Foo extends Panel` works correctly. The underscored alias exists only for the rare site that genuinely needs the unwrapped class for typing; reach for it only after confirming the callable form doesn't work.
