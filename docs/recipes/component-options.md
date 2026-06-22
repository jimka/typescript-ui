# Construct components, layouts, and stores from an options object

Every `Component` subclass, every `LayoutManager`, and every concrete `Store` / `Proxy` accepts an optional, trailing `options` parameter that maps directly to its setters. Pass styling, sizing, behavioural defaults, layout configuration, or store wiring at construction time instead of issuing chained setter calls.

## Goal

Replace boilerplate like this:

```typescript
const button = Button("Save");
button.setEnabled(false);
button.setForegroundColor("white");
button.setBackgroundColor("var(--ts-ui-accent)");
button.setBorderRadius("8px");
panel.addComponent(button);
```

with this:

```typescript
panel.addComponent(Button("Save", {
    enabled        : false,
    foregroundColor: "white",
    backgroundColor: "var(--ts-ui-accent)",
    borderRadius   : "8px",
}));
```

Component classes are callable in both `Foo(...)` and `new Foo(...)` form — pick whichever reads better. The bare-call form is recommended for nested trees because it removes `new` clutter.

## How the options object is layered

Every options interface extends a parent that mirrors the class hierarchy:

```
ComponentOptions
├── TextOptions             (Text, Label, Header, Legend)
├── InputOptions            (Input)
│   ├── TextInputOptions    (TextField, PasswordField)
│   ├── TextAreaOptions
│   ├── CheckboxOptions
│   └── SliderOptions
├── ButtonOptions           (Button, ToggleButton, SpinButton, TabCloseButton, AccordionHeader)
├── ComboBoxOptions
│   ├── ListOptions
│   └── MultiSelectListOptions
└── … (one per concrete component)
```

Subclass options inherit every parent field, so any `ComponentOptions` field — `border`, `padding`, `preferredSize`, `attributes`, etc. — is available on every component.

## Examples

### Naming a panel

The `name` option sets a component's human-readable title — distinct from its unique `id`. It is pure metadata (no DOM, no layout effect) that travels with the component across re-parents, and [`Tab`](/layouts/Tab) reads it to label a tab button (and a torn-off window) when no per-placement override is set.

```typescript
Component({ name: "Console", layoutManager: Fit() });
```

### Styling a label

```typescript
Label("Name", "user-input", {
    fontWeight: "bold",
    fontSize  : 16,
});
```

### Pre-configured numeric spinner

```typescript
NumberSpinner({
    value    : 50,
    min      : 0,
    max      : 100,
    step     : 5,
    precision: 0,
});
```

### Pre-populated combo box bound to a store

```typescript
ComboBox({
    store        : peopleStore,
    displayField : "name",
    valueField   : "id",
    selectedIndex: 0,
});
```

### Static-suggestion AutoComplete

```typescript
AutoCompleteField({
    suggestions: ["Apple", "Banana", "Cherry"],
    placeholder: "Type a fruit…",
    minChars   : 2,
});
```

### Declaring child components

`ComponentOptions.components` accepts an array of children (or `{ component, constraints }` pairs), removing the need for trailing `.addComponents(...)`:

```typescript
Panel({
    layoutManager: HBox(),
    components: [
        Text("Title:"),    TextField(),
        Text("Subtitle:"), TextField()
    ]
});
```

Per-child layout constraints via the `ConstrainedComponent` shape:

```typescript
Panel({
    layoutManager: Border(),
    components: [
        { component: header,  constraints: { placement: 'north'  } },
        { component: content, constraints: { placement: 'center' } },
        { component: footer,  constraints: { placement: 'south'  } }
    ]
});
```

### Wiring event listeners

The `listeners` bag is the declarative form of a component's typed `on()` surface. It accepts **exactly** the events that component exposes through `on()` — its own event names, each typed to the listener that `on()` expects — and is dispatched once at the end of the constructor. Any other key is a **compile error**: an event the component doesn't expose, a raw DOM event name it doesn't surface, or a typo.

```typescript
Button("Save", {
    listeners: {
        action: () => save(),   // ✓ Button exposes on("action")
    }
});

SplitGutter({
    listeners: {
        drag:     pos => console.log("dragged to", pos),  // ✓
        collapse: ()  => console.log("collapsed"),        // ✓
    }
});

Drawer({
    edge: "left",
    listeners: {
        open:  () => console.log("opened"),
        close: () => console.log("closed"),
    }
});
```

Because the bag mirrors `on()`, the compiler rejects anything outside that surface:

```typescript
Button("Save", {
    listeners: {
        click:    () => {},   // ✗ Button has no on("click") — compile error
        collapse: () => {},   // ✗ not a Button event — compile error
        actoin:   () => {},   // ✗ typo — compile error
    }
});
```

A component that exposes no `on()` surface (a plain `Component`, a `ToolBar`) has no `listeners` option at all — wire post-construction DOM listeners with `Event.addListener` instead. Listeners registered through the bag fire in registration order alongside any added later with `on()`. This is construction-time wiring only; use `on()` for listeners added after the component exists, and `off()` to detach.

## Layout managers

Layout managers follow the same pattern. The base `LayoutManagerOptions` interface is empty today; each concrete manager's interface adds its own settable fields.

```typescript
const hbox = HBox({ spacing: 12, stretching: true });
const grid = Grid({ rows: 4, columns: 4, spacing: 8 });
const split = Split({ direction: "vertical" });
const accordion = Accordion({
    singleOpen       : true,
    headerHeight     : 32,
    animationDuration: 150,
    listeners        : {
        sectiontoggle: (idx, open) => console.log(idx, open),
    },
});

panel.setLayoutManager(hbox);
```

The previous positional `VBox(spacing)` signature still compiles, and `new` works alongside the callable form for every concrete manager.

## Data layer

`Store`, `MemoryStore`, and `AjaxStore` accept either the historical positional form or a single options bag. `Proxy` config types have been renamed (`AjaxProxyConfig` → `AjaxProxyOptions`, `MemoryProxyConfig` → `MemoryProxyOptions`); the old names remain as deprecated type aliases.

```typescript
const store = new MemoryStore({
    model     : PersonModel,
    data      : initialPeople,
    pageSize  : 25,
    sorters   : [{ field: "name", dir: "asc" }],
    listeners : { load: () => console.log("loaded") },
});

const remote = new AjaxStore({
    model: PersonModel,
    proxy: { url: "/api/people", method: "GET", root: "data" },
    autoLoad: true,
});

const personModel = new Model({
    fields    : [{ name: "id", type: "number" }, { name: "name", type: "string" }],
    primaryKey: "id",
});
```

Data-layer classes (`Model`, `Store`, `MemoryStore`, `AjaxStore`, `Proxy`) are not currently part of the callable wrapper — they still require `new`. The options-bag pattern is identical regardless.

Store options accepted by every `AbstractStoreOptions` consumer: `pageSize`, `page`, `sorters`, `filters`, `autoLoad`, `listeners`. The `autoLoad: true` flag triggers `load()` from the constructor — registered `listeners` fire as expected.

## When to keep using setters

Use options for construction-time defaults. Use setters for any state that changes after the component, layout manager, or store is in the tree — selection, value updates, enabling/disabling, page changes, sort changes. The options bag is dispatched once, at the end of the constructor, then never read again.

## Backwards compatibility

The options parameter is purely additive: every existing positional call site continues to compile and behave identically. Migration is opportunistic — adopt the new style at new call sites, leave the old ones alone. The renamed `Config` types (`FieldConfig`, `AjaxProxyConfig`, `MemoryProxyConfig`, `AutoCompleteFieldConfig`) are kept as deprecated aliases.

## Calling components and layouts without `new`

Every `Component` subclass and every concrete `LayoutManager` (plus `ButtonGroup`) may be invoked without the `new` keyword. The bare-call form is equivalent to `new` — it constructs the same instance, accepts the same arguments, and produces a value that still satisfies `instanceof` and can serve as a superclass:

```typescript
const panel = Panel({
    layoutManager: HBox({ spacing: 10 }),
    components: [
        Button("OK"),
        Text("hello")
    ]
});

panel instanceof Panel;        // true
class MyPanel extends Panel {} // still works
```

Both forms compile and behave identically; pick whichever reads better at the call site. The bare-call form composes naturally with the `components: [...]` option to express a full UI tree as a single expression. See [Mental model — JSX-shaped, without JSX](/guide/mental-model#jsx-shaped-without-jsx) for the underlying mechanism.

## Forwarding options from a subclass via `super(options)`

A subclass of `Component` or `Panel` may pass an options bag to its parent constructor:

```typescript
class ComplexUIPanel extends Panel {
    constructor() {
        super({ layoutManager: new VBox({ stretching: true }) });

        this.addComponents(/* … */);
    }
}
```

Each level of the super chain applies the options it receives, so `layoutManager`, `border`, `padding`, and any other `ComponentOptions` field is honoured even though the leaf class is the one being instantiated. `addComponent` is a no-op when the child is already attached to the same parent, which keeps `applyOptions` safely idempotent if more than one level along the chain carries a `components` array.

Ordering note: when a subclass both accepts consumer-supplied options and builds its own internal children, anything passed up through `super(options)` is applied **before** the subclass's constructor body runs. If the consumer's options need to be applied last (for example, to override defaults the subclass sets), call `super()` with no arguments and invoke the setters at the end of the subclass constructor instead.
