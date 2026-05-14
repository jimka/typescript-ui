---
name: implement
description: Implement a pre-generated implementation plan. Use when the user asks to implement an implementation plan and that plan exists in the {workspace}/plans folder
---

## Keep in mind

### Code formatting

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

### Code Style

- Use arrow functions instead of .bind(this) for callbacks; include explicit parameter types when the target signature is `Function`
- Prefer separation of concerns: keep presentation/UI state out of data Models
- Use JSDoc in multi-line format (not single-line) for all exported APIs
- For TypeScript class member name collisions, use the underscore-prefix idiom for private backing fields

---

### Minimize direct DOM access

Direct DOM manipulation (e.g. `element.style.xxx`, `document.createElement`, native `addEventListener`) should be kept to an absolute minimum. Prefer the framework's Component setter/getter API and the `Event` class for all interactions that the framework already covers.

Before reaching for `element.style` or `document.createElement`, check whether a Component setter (`setWidth`, `setBackgroundColor`, `setPosition`, etc.) covers the need. Use raw DOM only for things the framework has no API for (e.g. the resize-handle `<div>` that lives inside a `<th>` and is not a full Component).

---

### Use the Event class for event handling

All component-level event listeners must go through `Event.addListener` / `Event.addViewportListener` rather than native `addEventListener`. Native listeners are acceptable only on raw DOM elements that are not `Component` instances (e.g. a raw helper `<div>`).

For any `Component` subclass, use `Event.addListener(this, type, handler)`. Reserve `element.addEventListener` for raw DOM helper elements that have no Component wrapper.

---

### One DOM element per class (separation of concerns)

A framework class should own and manage exactly one DOM element. Do not create or append sibling or wrapper elements from within a component's `render()`/`init()` methods beyond what that single element requires. If a visual sub-element needs independent behaviour, it should be its own `Component` subclass — unless it is a trivial non-interactive helper (such as a resize handle div) that has no independent identity.

Before appending a raw DOM child in `init()`, ask whether it warrants a full Component. If it does (e.g. needs event routing, its own CSS rule, or layout), extract it into a Component subclass.

---

### Always declare return types and class variable types explicitly

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

### Every function and method must have a JSDoc docstring

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

### All attributes and styles go through the framework's typed API

Never write to the DOM directly for attributes or styles. The framework provides a typed layer for every category:

**CSS styles** — use the Component setter/getter API (`setBackgroundColor`, `setWidth`, `setBorder`, `setPosition`, etc.) rather than `element.style`. This lets `Component.ts` batch-commit changes via the `setAutoCommitStyle(false)` / `setAutoCommitStyle(true)` pattern. If the needed property has no setter yet, add one. Exception: raw DOM helper elements (non-Component `<div>`s) may use `element.style` directly since they are outside the Component style system.

**ARIA attributes** — use `this.getAria()`, never `setElementAttribute("aria-*", ...)` or `element.setAttribute("aria-*", ...)`. The `Aria` class provides typed setters for every supported attribute. If one is missing, add it to `Aria.ts` rather than falling back to raw access. `role` and `tabindex` also go through `Aria`.

**All other HTML attributes** — determine scope first, then pick the right home:
- Attribute that applies to all elements → typed setter/getter in `Component.ts`.
- Attribute specific to one component (e.g. `name` on a radio input) → private backing field plus typed setter/getter in that component class; use `component.setElementAttribute(name, value)` internally to write to the DOM.
- Never call `element.setAttribute(...)` or `element.getAttribute(...)` directly from component code.

```typescript
// Never
element.setAttribute("aria-selected", "true");
element.style.color = "red";
element.setAttribute("name", groupId);

// Always
this.getAria().setSelected(true);       // ARIA → Aria class
this.setForegroundColor("red");         // CSS  → Component setter
this.setRadioName(groupId);             // HTML attr → typed setter → setElementAttribute internally
```

### Documentation updates

When the implementation changes consumer-visible behaviour, update the matching doc surfaces under `docs/`:

- **New public API symbol** (class, type, enum, exported function): re-export from the right per-subpath barrel in `src/typescript/lib/<group>/index.ts` (one of `core`, `primitive`, `layout`, `data`, `validation`, or `component/<sub>`). Add a `@category` tag to its TSDoc (Core / Components / Layouts / Data / Theme / Validation / Util) and verify the symbol appears in the right section of `docs/api/<group>/index.md` after build.
- **New component / layout / data class / concept**: add a curated page under the matching `docs/<group>/` folder, link it in the sidebar (`docs/.vitepress/config.mts`), and add it to that group's `index.md` catalog.
- **New recipe-worthy pattern**: add a page under `docs/recipes/`, link it in both the sidebar and `docs/recipes/index.md`.
- **Behaviour change visible to consumers**: update the matching concept page in `docs/concepts/`, and update `docs/reference/faq.md` or `troubleshooting.md` if the change resolves or introduces a footgun.

Run `npm run docs:build` and confirm 0 errors before declaring the implementation done. Bug fixes and internal refactors that don't change the public API surface usually need no doc edits.

#### Writing navigable JSDoc

Cross-bucket references in JSDoc need explicit markdown links because TypeDoc emits one entry-point bundle per subpath (`@jimka/typescript-ui/core`, `…/layout`, …) — a `{@link Foo}` tag only resolves to symbols *in the same bucket*. Bare backticks render as code-formatted text without navigation.

Use this matrix:

| Reference target | Form to write in JSDoc |
| --- | --- |
| Symbol in the **same file or same bucket** as the JSDoc you're writing | `{@link Foo}` — TypeDoc resolves it |
| Symbol in a **different bucket** (e.g. `Window` from inside `component/display`) | `[\`Foo\`](/api/<subpath>/<kind>/Foo)` — site-relative markdown link |
| The class itself (a class's JSDoc mentioning its own name) | Plain backticks `` `Foo` ``. A link back to the page you're already on is noise. |

Subpath kinds: `classes`, `interfaces`, `enumerations`, `type-aliases`, `variables`, `functions`. For example: `[\`Field\`](/api/data/classes/Field)`, `[\`Bindable\`](/api/core/interfaces/Bindable)`, `[\`Direction\`](/api/component/container/enumerations/Direction)`.

For names that collide across buckets (`Border` in `primitive` + `layout`; `Body`/`Header`/`Row`/`Column` in `core`/`component/display`/`component/table`/`layout`), spell out the subpath explicitly to avoid linking to the wrong one. In prose, mention the rename pattern consumers will use: `[\`Header\`](/api/component/table/classes/Header) (often aliased to \`TableHeader\` on import)`.

Verify navigability:

- `npm run docs:build` — must report **0 errors and 0 link warnings**. The lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice.
- A `{@link Foo}` that doesn't resolve renders as plain text and surfaces as a typedoc warning. Either move the link target into scope (e.g. `import type { Foo } from '~/<group>/Foo.js';`) or convert it to the markdown form above.

#### The typedoc-callable-plugin

The framework's component classes are wrapped at module exit time via the `callable()` Proxy helper — `export { ButtonCallable as Button }`. To TypeScript and TypeDoc that looks like a `const`, so without intervention TypeDoc would emit `docs/api/<bucket>/variables/Button.md` containing just the typeof signature, with the class's methods and JSDoc unreachable.

[`typedoc-callable-plugin.mjs`](../../../typedoc-callable-plugin.mjs) (registered in [`typedoc.json`](../../../typedoc.json)'s `plugin` array) inspects every variable whose initializer is `callable(X)`, locates the underlying class `X`, and re-emits the reflection as `docs/api/<bucket>/classes/Button.md` with the full class documentation (methods, constructors, JSDoc, inheritance) attached. On a clean docs build it prints `callable-plugin: promoting N callable variables to classes` where N is the count.

You don't need to do anything special when adding a new `callable()`-wrapped class — the plugin picks it up automatically as long as:

- The public export is `export { XCallable as X }` (or any alias of a `const X = callable(_X)`).
- The inner class (`_X`) is a real TypeScript `class` declaration in the same file.
- The wrapping call is literally `callable(...)` (the plugin matches the identifier name).

If a new class shows up under `docs/api/<bucket>/variables/` instead of `…/classes/` after `npm run docs:build`, check those three conditions before touching the plugin.

### Git workflow

When making commits during implementation:

- **No author or co-author attribution in commit messages.** Do not append a `Co-Authored-By:` trailer (for Claude, the user, or anyone else). Authorship lives in the git `Author`/`Committer` fields, not in the message body. Plain trailing-attribution lines like `Generated with …` are also out.
- **Do not merge branches.** When a feature branch is ready, leave it for the user to review and merge. Don't run `git merge`, `git rebase` onto a base branch, or any squash/fast-forward integration.
- **Do not push to the remote.** No `git push` of any kind — not for feature branches, not for the working branch, not even for "harmless" doc-only updates. The user pushes when they decide the code is ready for the remote.

Commit, branch, and stage freely; integration and publication are the user's call.

## Work Instructions

1. Locate and read the referenced implementation plan in the {workspace}/plans folder.
2. Perform the implementation.
3. If applicable, extend the demo panel(s) to show off the implemented feature.
4. When done, move the implementation plan to the {workspace}/plans/implemented folder.
5. Update the documentation in `docs/` per _Documentation updates_ above.
