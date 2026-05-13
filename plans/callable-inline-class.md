# Restructure callable classes to inline class expressions (Go-to-Definition fix)

## Context

The [callable components plan](callable-components.md) added a `Proxy`-based callable form to ~36 classes using this export shape:

```ts
class Panel extends Component { /* body */ }
const PanelCallable = callable(Panel);
type PanelCallable = Panel;
export { Panel as _Panel, PanelCallable as Panel };
```

This works correctly at runtime, but breaks **ctrl+click / Go-to-Definition** in VS Code. The exported `Panel` value binding is the `PanelCallable` const, so navigation follows the value chain and stops at `const PanelCallable = callable(Panel)` instead of jumping to the class body. Users have to scroll one hop to find the class.

This plan restructures every wrapped class so the class declaration sits *at* the export site as a named class expression inside `callable(...)`. Ctrl+click then lands directly on the class.

## Approach

Replace the four-line export pattern with a one-expression form:

```ts
// Before
class Panel extends Component { /* body */ }
const PanelCallable = callable(Panel);
type PanelCallable = Panel;
export { Panel as _Panel, PanelCallable as Panel };

// After
export const Panel = callable(class Panel extends Component { /* body */ });
export type Panel = InstanceType<typeof Panel>;
```

### Why this fixes Go-to-Definition

TypeScript's "Go to Definition" follows value bindings. With the inline form, the exported `Panel` const is defined right where the class expression is written, so navigation lands on the `export const Panel = callable(class Panel extends Component {...})` line with the class body immediately visible.

### Why the leaf-check `this.constructor === Panel` still works

Named class expressions (`class Panel extends Component`) create a binding for `Panel` **only inside the class body**. Inside the constructor, `Panel` refers to the class expression itself, shadowing the outer `const Panel` (which is the callable proxy). So:

```ts
export const Panel = callable(class Panel extends Component {
    constructor(options?: PanelOptions) {
        super({ tag: options?.tag ?? "div" });
        // `Panel` here = the inner class expression, NOT the outer proxy const.
        // The leaf-only applyOptions guard still works.
        if (this.constructor === Panel && options) {
            this.applyOptions(options);
        }
    }
});
```

`this.constructor` resolves to the underlying class (the class expression). The inner `Panel` reference resolves to the same class expression via the class-body scope binding. They match. ✓

### Why other invariants still hold

- **Stack traces**: named class expression `class Panel extends Component` exposes `"Panel"` as the function name. Stack frames still read `at new Panel (...)`.
- **`Panel.name`**: `Panel.name` accesses `.name` on the proxy, which forwards to the inner class expression. Returns `"Panel"`.
- **`instance instanceof Panel`**: Proxy preserves `Symbol.hasInstance` via the default `Function.prototype[Symbol.hasInstance]`. Still works.
- **`class Sub extends Panel`**: extending the callable still resolves to the underlying class's `[[Construct]]`. TS picks the construct signature from `Callable<T>`.
- **`InstanceType<typeof Panel>`**: `typeof Panel` is `Callable<typeof InnerPanel>`, which is an intersection that includes the construct signature. `InstanceType` extracts the instance type via the construct signature, giving the same instance type as before.

### Net change per file

- **Removed**: separate `class Foo extends Bar { ... }` declaration, separate `const FooCallable = callable(Foo)`, separate `type FooCallable = Foo`, and the `Foo as _Foo` debug-only re-export.
- **Added**: one `export const Foo = callable(class Foo extends Bar { ... })` wrapper and one `export type Foo = InstanceType<typeof Foo>` line.
- **Lines saved**: ~3 per file. The `_Foo` debug export disappears across the codebase (it was never imported anywhere, per the original plan's design).

## Files to touch

Same surface as [callable-components.md](callable-components.md). One new helper rename, then mechanical conversion across:

- [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts) — the god node; convert first and type-check before fanning out.
- All ~24 Component subclasses listed in the original plan, under [src/typescript/Base/](src/typescript/Base/), [src/typescript/Base/component/](src/typescript/Base/component/), and [src/typescript/](src/typescript/) (the demo panels).
- All ~12 concrete LayoutManager subclasses under [src/typescript/Base/layout/](src/typescript/Base/layout/) (Absolute, HBox, VBox, Row, Column, Grid, Card, Border, Accordion, Split, Tab, Table, Fit). [LayoutManager.ts](src/typescript/Base/layout/LayoutManager.ts) itself stays untouched (abstract).

### Files with `this.constructor === LocalClass` checks (extra care)

These 8 files have the leaf-check pattern. The class-expression name shadowing handles them automatically, but smoke-test each one after conversion:

- [Component.ts:222](src/typescript/Base/Component.ts#L222)
- [Panel.ts:44](src/typescript/Base/Panel.ts#L44)
- [List.ts:31](src/typescript/Base/component/List.ts#L31)
- [ComboBox.ts:65](src/typescript/Base/component/ComboBox.ts#L65)
- [TextInput.ts:32](src/typescript/Base/component/TextInput.ts#L32)
- [Text.ts:95](src/typescript/Base/component/Text.ts#L95)
- [Button.ts:95](src/typescript/Base/component/Button.ts#L95)
- [Input.ts:30](src/typescript/Base/component/Input.ts#L30)

Verify the leaf-only `applyOptions` actually fires (or doesn't) at the right level — easiest test: instantiate `Panel({ insets: ... })` and confirm `setInsets` is called via the leaf-only path.

### Optional polish (separate, can be skipped)

While the helper is being touched, consider renaming the apply trap handler in [Callable.ts](src/typescript/Base/Callable.ts) so stack frames label themselves:

```ts
return new Proxy(Cls, {
    apply: function callableConstruct(target, _, args) {
        return Reflect.construct(target, args);
    },
}) as Callable<T>;
```

Cosmetic only — frames read `at callableConstruct (Callable.ts:..)` instead of `at Object.apply`.

## Edge cases

- **TS resolution of `extends` against a callable const**: TS picks the construct signature from `Callable<T> = T & ((...) => InstanceType<T>)`. Confirmed working in the current callable rollout — no change here.
- **Class expressions and decorators**: not used in this codebase, so n/a. If decorators are added later, they apply to class expressions identically to declarations.
- **Re-exports via barrel files**: nothing in this codebase uses index/barrel re-exports for these classes (each consumer imports directly). The conversion doesn't break import paths.
- **`_Foo` debug-exports**: the conversion removes them. Verify with a grep that no consumer imports `_Component`, `_Panel`, etc. before deleting. If anything does (unlikely — they were added without callers per the original plan), either keep an explicit alias or update the consumer.

## Verification

End-to-end checks, ordered for safe rollout:

1. **Convert [Component.ts](src/typescript/Base/Component.ts) first**, in isolation:
   ```
   npx tsc --noEmit
   ```
   Expect zero new errors. Subclasses still compile because they extend `Component` (the const), which still satisfies `extends` via its construct signature.

2. **Convert one leaf subclass with a leaf-check** ([Panel.ts](src/typescript/Base/Panel.ts) is the simplest). Type-check, then run the demo (`npm run dev` or equivalent) and load [ComplexUIPanel.ts](src/typescript/ComplexUIPanel.ts). Confirm panels render identically and `Panel({ insets: ... })` still applies insets via `applyOptions`.

3. **Convert the rest** in a single mechanical pass. The transformation is uniform enough that a small `sed`/codemod script could do it, but manual review on the 8 leaf-check files is worth the few minutes.

4. **Ctrl+click verification** (the whole point of the refactor): in VS Code, open [ComplexUIPanel.ts](src/typescript/ComplexUIPanel.ts), ctrl+click any of `Panel`, `HBox`, `Text`, `Button`. Each should land directly on `export const Foo = callable(class Foo extends ...)` with the class body visible.

5. **`instanceof` smoke test**: add a temporary `console.assert(panel instanceof Panel)` in any demo. Confirm no assertion fires.

6. **Stack-trace sanity**: temporarily `throw new Error("test")` from inside a Component subclass constructor, instantiate via the bare-call form, and confirm the stack reads `at new Foo (...)` and not `at <anonymous>`.

7. **Final type-check**:
   ```
   npx tsc --noEmit
   ```

8. **Refresh the graph** (per CLAUDE.md):
   ```
   graphify update .
   ```

## Things explicitly NOT done in this plan

- **No behavioral changes.** Pure restructuring. Runtime semantics, types, `instanceof`, `.name`, and stack traces are all preserved.
- **No new public API.** The `callable()` helper and its `Callable<T>` type stay as-is (modulo the optional handler-naming polish in §Optional polish).
- **No `children:` constructor option.** Still deferred to its own plan.
