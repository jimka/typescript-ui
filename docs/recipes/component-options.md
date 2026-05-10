# Construct components, layouts, and stores from an options object

Every `Component` subclass, every `LayoutManager`, and every concrete `Store` / `Proxy` accepts an optional, trailing `options` parameter that maps directly to its setters. Pass styling, sizing, behavioural defaults, layout configuration, or store wiring at construction time instead of issuing chained setter calls.

## Goal

Replace boilerplate like this:

```typescript
const button = new Button("Save");
button.setEnabled(false);
button.setForegroundColor("white");
button.setBackgroundColor("var(--ts-ui-accent)");
button.setBorderRadius("8px");
panel.addComponent(button);
```

with this:

```typescript
panel.addComponent(new Button("Save", {
    enabled        : false,
    foregroundColor: "white",
    backgroundColor: "var(--ts-ui-accent)",
    borderRadius   : "8px",
}));
```

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

### Styling a label

```typescript
new Label("Name", "user-input", {
    fontWeight: "bold",
    fontSize  : 16,
});
```

### Pre-configured numeric spinner

```typescript
new NumberSpinner({
    value    : 50,
    min      : 0,
    max      : 100,
    step     : 5,
    precision: 0,
});
```

### Pre-populated combo box bound to a store

```typescript
new ComboBox({
    store        : peopleStore,
    displayField : "name",
    valueField   : "id",
    selectedIndex: 0,
});
```

### Static-suggestion AutoComplete

```typescript
new AutoCompleteField({
    suggestions: ["Apple", "Banana", "Cherry"],
    placeholder: "Type a fruit…",
    minChars   : 2,
});
```

## Layout managers

Layout managers follow the same pattern. The base `LayoutManagerOptions` interface is empty today; each concrete manager's interface adds its own settable fields.

```typescript
const hbox = new HBox({ spacing: 12, stretching: true });
const grid = new Grid({ rows: 4, columns: 4, spacing: 8 });
const split = new Split({ direction: "vertical" });
const accordion = new Accordion({
    singleOpen       : true,
    headerHeight     : 32,
    animationDuration: 150,
    onSectionToggle  : (idx, open) => console.log(idx, open),
});

panel.setLayoutManager(hbox);
```

The previous positional `new VBox(spacing)` and `new Split(direction)` signatures still compile.

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

const Model = new Model({
    fields    : [{ name: "id", type: "number" }, { name: "name", type: "string" }],
    primaryKey: "id",
});
```

Store options accepted by every `AbstractStoreOptions` consumer: `pageSize`, `page`, `sorters`, `filters`, `autoLoad`, `listeners`. The `autoLoad: true` flag triggers `load()` from the constructor — registered `listeners` fire as expected.

## When to keep using setters

Use options for construction-time defaults. Use setters for any state that changes after the component, layout manager, or store is in the tree — selection, value updates, enabling/disabling, page changes, sort changes. The options bag is dispatched once, at the end of the constructor, then never read again.

## Backwards compatibility

The options parameter is purely additive: every existing positional call site continues to compile and behave identically. Migration is opportunistic — adopt the new style at new call sites, leave the old ones alone. The renamed `Config` types (`FieldConfig`, `AjaxProxyConfig`, `MemoryProxyConfig`, `AutoCompleteFieldConfig`) are kept as deprecated aliases.
