# Coding Guidelines

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
