# Constructing components

## Two ways to construct

Every component and layout manager can be built with or without `new`; both produce the same instance.

```typescript
const a = Button("Save");      // callable shorthand — no `new`
const b = new Button("Save");  // classic — identical result
a instanceof Button;           // true
```

The bare-call form is preferred for nested trees because it removes `new` clutter. See [mental model — JSX-shaped, without JSX](/guide/mental-model#jsx-shaped-without-jsx) for the expression shape this enables.

## The options bag and nesting

Components, layouts, and stores take a trailing options object mapping to setters. `layoutManager:` and `components:` (an array of children, or `{ component, constraints }` pairs) express a tree in one expression:

```typescript
Panel({
    layoutManager: HBox({ spacing: 10 }),
    components: [Button("OK"), Text("hello")]
});
```

See [Construct components from an options object](/recipes/component-options) for the full example gallery — naming a panel, styling a label, combo boxes, listeners, layout managers, and data-layer options.

## Which exports are callable

| Category | Callable (`Foo(...)` **or** `new Foo(...)`) | Source location |
| --- | --- | --- |
| UI components | ✅ every `Component` subclass — buttons, inputs, display, lists, tables, trees, menus, charts, containers, diagram | `src/typescript/lib/component/**` |
| Core containers | ✅ `Component`, `Container`, `Panel`, `Form`, `AnimatedDropdown` | `src/typescript/lib/core/` |
| Overlays | ✅ `Window`, `TabWindow`, `Dialog`, `Drawer`, `Rail`, `Dock`, `Menu`, `Popover`, `Tooltip`, `ButtonGroup`, … | `src/typescript/lib/overlay/` |
| Layout managers | ✅ `HBox`, `VBox`, `Border`, `Grid`, `Fit`, `Card`, `Tab`, `Split`, `Accordion`, `Absolute`, `Anchor`, `HFlow`, `VFlow` | `src/typescript/lib/layout/` |
| **Data layer** | ❌ **require `new`** — `Model`, `Field`, `ModelRecord`, `Association`, `Store`, `MemoryStore`, `AjaxStore`, `TreeStore`, `TreeNode`, `Proxy`, `MemoryProxy`, `AjaxProxy`, `WebStorageProxy`, `JsonReader`, `JsonWriter` | `src/typescript/lib/data/**` |

The contrast is one you will hit directly when wiring a table to data:

```typescript
const store = new MemoryStore({ model: PersonModel, data: people }); // `new` REQUIRED — data layer
const table = Table(store);                                          // callable — Component subclass
```

## Why it works / how to tell

The callable form comes from [`callable()`](/api/core/classes/Callable) — a `Proxy` whose `apply` trap forwards to `Reflect.construct`, which is why `instanceof`, `new`, and `extends` all still work on the wrapped export. The rule for telling whether an export is callable: its module wraps the class and re-exports the wrapper under the public name — the raw class ships as `_Foo`, the callable wrapper as `Foo`. The `data/` layer never applies this wrapper.

## See also

- [Construct components from an options object](/recipes/component-options)
- [Mental model — JSX-shaped, without JSX](/guide/mental-model#jsx-shaped-without-jsx)
- [Data binding](/concepts/data-binding)
