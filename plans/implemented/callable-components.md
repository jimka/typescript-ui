# Make Components and Layout Managers callable without `new`

## Context

Today, building a UI tree is verbose:

```ts
const panel = new Panel({ layout: new HBox({ spacing: 10 }) });
panel.addComponent(new Button({ text: "OK" }));
panel.addComponent(new Text("hello"));
```

The goal is to remove the `new` keyword across [`Component`](src/typescript/Base/Component.ts) (and its ~20 subclasses) and the concrete [`LayoutManager`](src/typescript/Base/layout/LayoutManager.ts) subclasses, so that callers can write:

```ts
const panel = Panel({ layout: HBox({ spacing: 10 }) });
panel.addComponent(Button({ text: "OK" }));
panel.addComponent(Text("hello"));
```

This is a foundation. Once the callable form is in place, a follow-up plan will add a `children?: Component[]` option to `ComponentOptions` so an entire tree can be declared in one expression. **That follow-up is out of scope here.**

`Component` is the top god node (235 edges per `graphify-out/GRAPH_REPORT.md`). The cleanest way to add the call signature without rewriting all 30+ classes is to wrap each class with a `Proxy` that has an `apply` trap routing bare calls to `new`.

## Approach

Add a single tiny helper module, then add **two lines** per class file (one re-binding the const, one re-exporting under the public name). Subclasses, options interfaces, and `instanceof` checks all keep working unchanged.

### 1. New helper module

Create [src/typescript/Base/Callable.ts](src/typescript/Base/Callable.ts):

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Wraps a class so it can be invoked without `new`. The returned value still
 * works with `new`, with `instanceof`, and as the right-hand side of `extends`.
 *
 * `instance.constructor` continues to point at the original class (the Proxy
 * forwards [[Construct]] to it), so leaf-only checks like
 * `this.constructor === Foo` inside subclass constructors keep working.
 */
export type Callable<T extends new (...args: any[]) => any> =
    T & ((...args: ConstructorParameters<T>) => InstanceType<T>);

export function callable<T extends new (...args: any[]) => any>(Cls: T): Callable<T> {
    return new Proxy(Cls, {
        apply: (target, _thisArg, args) => Reflect.construct(target, args),
    }) as Callable<T>;
}
```

Why `Reflect.construct` over `new target(...args)`: identical runtime result, but plays nicer with future subclassing scenarios where `new.target` matters.

### 2. Per-class export pattern

For each class to be made callable, keep the class declaration *unexported* and re-export it under its original name via the helper:

```ts
// Before
export class Panel extends Component { /* ... */ }

// After
class Panel extends Component { /* unchanged body */ }
const PanelCallable = callable(Panel);
type PanelCallable = Panel;
export { PanelCallable as Panel };
```

Why aliasing instead of renaming the class itself: keeps the class name `Panel` in stack traces, `this.constructor.name`, devtools, and existing `this.constructor === Panel` checks (which reference the local, in-module name). The public export — both as type and as value — is `Panel`.

External call sites do not change. `import { Panel } from "./Panel"` still works; `panel instanceof Panel` still works (Proxy preserves `Symbol.hasInstance` through default `Function.prototype[Symbol.hasInstance]`, which walks the prototype chain). `class X extends Panel {}` still works (TS picks the construct signature from `Callable<T>`).

### 3. Files to touch

**Helper (1 new file):**
- [src/typescript/Base/Callable.ts](src/typescript/Base/Callable.ts) — new

**Base class (1 file):**
- [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts) — wrap export at [Component.ts:139](src/typescript/Base/Component.ts#L139)

**Component subclasses (24 files)** — apply the same wrap-and-alias pattern:
- [src/typescript/Base/Panel.ts](src/typescript/Base/Panel.ts)
- [src/typescript/Base/Body.ts](src/typescript/Base/Body.ts)
- [src/typescript/Base/Dialog.ts](src/typescript/Base/Dialog.ts)
- [src/typescript/Base/Menu.ts](src/typescript/Base/Menu.ts)
- [src/typescript/Base/Notification.ts](src/typescript/Base/Notification.ts)
- [src/typescript/Base/Tooltip.ts](src/typescript/Base/Tooltip.ts)
- [src/typescript/Base/Window.ts](src/typescript/Base/Window.ts)
- All files under [src/typescript/Base/component/](src/typescript/Base/component/) (Button, ComboBox, Text, TextInput, Input, List, Image, ProgressBar, ProgressSpinner, Scrollbar, Header, FieldSet, Option, RadioButton, MenuItem, MenuSeparator, NumberSpinner, PaginationBar, FontAwesomeIcon, AutoCompleteField, AutoCompleteDropdown, AutoCompleteItem, ListItem, DialogBackdrop, SplitGutter, WindowBorder, MenuBar, MenuBarButton, Table cells, Tree, TreeRow)
- Validation: [src/typescript/Base/validation/FieldDecorator.ts](src/typescript/Base/validation/FieldDecorator.ts)
- Demo panels under [src/typescript/](src/typescript/) (AccordionPanel, BaselinePanel, BindingPanel, BorderPanel, ComplexUIPanel, FitPanel, LayoutTestPanel, MenuBarPanel, MiscPanel, MultiSelectListPanel, SplitPanel, TabPanel) — these extend Panel; wrapping them keeps the pattern consistent so the demo code can drop `new` too.

**LayoutManager subclasses (10 files)** — concrete layout managers only. [LayoutManager.ts](src/typescript/Base/layout/LayoutManager.ts) itself is `abstract` and not callable; leave it untouched.
- [src/typescript/Base/layout/Absolute.ts](src/typescript/Base/layout/Absolute.ts)
- [src/typescript/Base/layout/HBox.ts](src/typescript/Base/layout/HBox.ts)
- [src/typescript/Base/layout/VBox.ts](src/typescript/Base/layout/VBox.ts)
- [src/typescript/Base/layout/Row.ts](src/typescript/Base/layout/Row.ts)
- [src/typescript/Base/layout/Column.ts](src/typescript/Base/layout/Column.ts)
- [src/typescript/Base/layout/Grid.ts](src/typescript/Base/layout/Grid.ts)
- [src/typescript/Base/layout/Card.ts](src/typescript/Base/layout/Card.ts)
- [src/typescript/Base/layout/Border.ts](src/typescript/Base/layout/Border.ts)
- [src/typescript/Base/layout/Accordion.ts](src/typescript/Base/layout/Accordion.ts)
- [src/typescript/Base/layout/Split.ts](src/typescript/Base/layout/Split.ts)
- [src/typescript/Base/layout/Tab.ts](src/typescript/Base/layout/Tab.ts)
- [src/typescript/Base/layout/Table.ts](src/typescript/Base/layout/Table.ts)
- [src/typescript/Base/layout/Fit.ts](src/typescript/Base/layout/Fit.ts)

### 4. Edge cases and how they're handled

- **`this.constructor === Foo` checks in subclass constructors** (8 sites: [Component.ts:222](src/typescript/Base/Component.ts#L222), [Panel.ts:44](src/typescript/Base/Panel.ts#L44), [List.ts:31](src/typescript/Base/component/List.ts#L31), [ComboBox.ts:65](src/typescript/Base/component/ComboBox.ts#L65), [TextInput.ts:32](src/typescript/Base/component/TextInput.ts#L32), [Text.ts:95](src/typescript/Base/component/Text.ts#L95), [Button.ts:95](src/typescript/Base/component/Button.ts#L95), [Input.ts:30](src/typescript/Base/component/Input.ts#L30)) — these reference the *in-module* class name, which remains the unwrapped class. `this.constructor` resolves to the original class (the Proxy forwards `[[Construct]]`). The check still holds.

- **`instanceof Component` guard at [Component.ts:1943](src/typescript/Base/Component.ts#L1943)** — Proxies preserve `instanceof` through default `Function.prototype[Symbol.hasInstance]`, which walks the instance's prototype chain. Accessing `Panel.prototype` on the Proxy returns the original class's prototype via the default `get` trap. Still works.

- **`class Sub extends Panel {}`** — JS engines accept any value with `[[Construct]]` as the extends target. The Proxy forwards `[[Construct]]`. TS accepts the intersection of construct + call signatures for `extends`.

- **Static methods / static fields** — the Proxy's default `get` trap forwards to the underlying class, so `SomeClass.staticMethod()` works unchanged.

- **`graphify update .`** — per CLAUDE.md, run after the edits land so the graph reflects the new export pattern.

### 5. Things explicitly NOT done in this plan

- **No `children?: Component[]` option.** Follow-up plan once the callable form is in use.
- **`LayoutManager` (abstract base) is not wrapped.** It's never `new`-ed directly.
- **`BaseObject`, `Insets`, `Border`, `Size`, etc. are not wrapped.** Not in scope; the user asked only for Components and LayoutManagers.

## Verification

End-to-end checks after the edits:

1. **Type-check the whole project**:
   ```
   npx tsc --noEmit
   ```
   Must pass with zero new errors. The `--strict` flag is already on per [tsconfig.json](tsconfig.json).

2. **`new` still works** (backwards-compatible). Pick a few existing call sites in [src/typescript/](src/typescript/) (e.g. demo panels) and confirm they continue to compile and run without modification.

3. **Bare call works**. In any demo panel constructor (e.g. [ComplexUIPanel.ts](src/typescript/ComplexUIPanel.ts)), swap one `new Panel(...)` for `Panel(...)` and one `new HBox(...)` for `HBox(...)`. Build, load the demo page, confirm visually identical layout.

4. **`instanceof` still works**. Add a temporary `console.assert(panel instanceof Panel)` near the swap, confirm no assertion fires.

5. **Subclass `extends` still works**. Any of the demo panels (e.g. [BorderPanel.ts](src/typescript/BorderPanel.ts)) extends `Panel`; if compilation passes for them, this is verified.

6. **Run the existing benchmark** ([Benchmark community in graph](graphify-out/GRAPH_REPORT.md)) to confirm there's no perceptible per-construction overhead from Proxy. Proxies on construction are ~negligible but worth a sanity check given Component's centrality.

7. **Refresh the graph**:
   ```
   graphify update .
   ```
