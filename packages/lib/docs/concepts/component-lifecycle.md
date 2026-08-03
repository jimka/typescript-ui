# Component lifecycle

A [`Component`](/api/core/classes/Component) goes through a small, predictable sequence of phases from construction to destruction. Understanding it explains when DOM elements appear, when layout runs, and where to hook your own subclass code.

## The phases

```
Component(tag)            ─→  in-memory object, no DOM
   │
addComponent(child)       ─→  parent registers the child
   │
getElement()              ─→  first call creates the <div>; subsequent
                              calls return the cached element
   │
render() (subclass hook)  ─→  builds bespoke DOM (called from getElement
                              when an element is needed)
   │
init() (subclass hook)    ─→  wires native listeners, sets initial styles
   │
doLayout()                ─→  layout manager positions children, writes
                              x / y / width / height pixel values
   │
        … updates …
   │
removeComponent(child)    ─→  detaches from the parent tree
   │
destructor() (protected)  ─→  subclass cleanup hook
```

## Construction

```typescript
const button = Button('Save');
```

The component object exists in memory immediately. No `<div>`, no styles, no listeners — just JavaScript state. You can call any setter (`setPosition`, `setForegroundColor`, `setBorder`) at this point, or supply matching options in a trailing options bag — `Button('Save', { foregroundColor: '#fff', preferredSize: { width: 120, height: 32 } })`. Values are stashed and replayed when the DOM element is eventually created.

This is why `setBackgroundColor` works *before* you've added the component to a parent. The framework defers DOM work until it's actually needed.

`new Button('Save')` also works — every component class is callable in both forms. Bare-call is the recommended style; `new` is kept for backwards compatibility.

## Adding to a parent

```typescript
panel.addComponent(button);                       // single child
panel.addComponents(button, label, textField);    // variadic
panel.addComponents([button, label, textField]);  // or as an array
```

`addComponent` registers a child with its parent's component list and applies the parent's layout-manager constraints (optional second argument). `addComponents` accepts any mix of bare components, `{ component, constraints }` pairs, or arrays of either. Neither call forces a DOM commit — the element is still lazy.

For a fully declarative tree, pass children via the `components` option at construction time:

```typescript
const panel = Panel({
    layoutManager: VBox(),
    components: [Button('Save'), Button('Cancel')]
});
```

## Element creation: `getElement()`

```typescript
button.getElement(); // first call: creates the <div>
```

The first call to `getElement()` invokes the subclass's `render()` followed by `init()`. From here on, the component has a real DOM node. Anything you set before is replayed onto the element.

You usually don't call `getElement()` directly — it's called for you the first time the component participates in a layout pass.

## Layout: `doLayout()`

Layout is what positions absolutely-positioned children and writes pixel values for `top` / `left` / `width` / `height`. It runs:

1. **At first render** — when the root `Body` lays out top-level children.
2. **On viewport resize** — `Body` listens for `window.resize` and re-runs layout.
3. **Explicitly** — when you call `parent.doLayout()` after changing a child's preferred size.

```typescript
button.setPreferredSize({ width: 120, height: 32 });
button.getParentComponent()?.doLayout(); // child's parent re-runs layout
```

::: tip rAF-coalesced scheduling
Internally, setters and event handlers call `scheduleLayout()` rather than `doLayout()` directly. The queue flushes once per animation frame and prunes any component whose ancestor is also dirty (the ancestor's layout will recurse into it). Multiple changes within the same frame coalesce into a single layout pass.
:::

## Pausing layout

For bulk mutations, suspend automatic layout passes:

```typescript
panel.pauseLayout();
panel.addComponents(largeArray.map(buildItem));
panel.resumeLayout(); // triggers a single doLayout afterwards
```

`pauseLayout()` blocks `scheduleLayout()`; `resumeLayout()` triggers a synchronous layout pass and re-enables scheduling. Without these, every `addComponent` would queue its own layout, and rAF coalescing would still mean one batched pass — but `pauseLayout` makes the intent explicit and disables the scheduling work entirely during the bulk operation.

## Removal

```typescript
panel.removeComponent(button);
```

Detaches the component from the parent's child list. Future layout passes ignore it. The DOM element is removed; future calls to `getElement()` would re-create it from scratch.

## Moving between parents

```typescript
newPanel.moveComponent(button);        // append to a different parent
newPanel.moveComponent(button, 0);     // insert at an index
panel.moveComponent(button, 0);        // reorder within the same parent
```

`moveComponent` detaches a child from its current parent (if any) and attaches it to the destination in a single call, so you don't have to pair `removeComponent` with `addComponent` yourself. It is a method on the *destination* container, matching the rest of the `addComponent` / `insertComponent` / `removeComponent` family. Omitting the index appends; supplying one inserts (and clamps to `[0, children.length]`). Both the source and destination re-layout. The child's [`LayoutConstraints`](/api/layout/classes/LayoutConstraints) are carried across unless you pass an explicit override — useful when the new container's layout vocabulary differs. The element is detached and re-attached, so any in-flight CSS transition on it is reset by the move.

## Subclass hooks

If you write your own component subclass, override these in addition to whatever public surface you expose:

| Hook | When | Purpose |
| --- | --- | --- |
| `render()` (protected) | Called by `getElement()` on first access | Build the DOM element. Default returns a `<div>` (or whatever was passed to `super(tag)`). |
| `init()` (protected) | Called once the element exists | Wire native listeners, apply initial styles. The framework calls this after `render()`. |
| `doLayout()` | Called on every layout pass | Override only if you need custom positioning beyond what a `LayoutManager` provides. |
| `destructor()` (protected) | Called on disposal (`dispose()`), including via an ancestor's own teardown — never on `removeComponent` | Clean up listeners, timers, theme subscriptions, and any in-flight animation (cancel its `Animation.CancelHandle` *before* `super.destructor()`, which releases the element handle the animation would otherwise write to). Always runs, including when an ancestor's own teardown recurses into this component — this is the hook to override, never `dispose()`. |

The framework uses these in built-in components — `Button` adds a label in `init()`, `Window` wires drag handlers, `Text` subscribes to `ThemeManager.onThemeChange` through `subscribeTheme`.

## Disposal

`destructor()` (protected, in the table above) and `dispose()` (public) are not interchangeable — they're the two ends of the same seam:

- **`destructor()` is the override hook.** Write your subclass's cleanup there. It always runs, whether this component is destroyed directly or reached as a descendant of some ancestor's own teardown.
- **`dispose()` is the public call entry point.** Call it — never override it — to tear down a component you own that is *not* a registered child, so nothing else would ever reach it: a factory-built placeholder, a component held only in a private field. It recursively destroys the component's children, releases every tracked theme subscription, unregisters every DOM listener it registered through the `Event` API, removes the DOM element, deletes its per-instance stylesheet rules, and releases tracked handles; it is idempotent, so calling it twice is harmless.

A registered child (anything passed to `addComponent` / `insertComponent`) needs none of this from its owner: when the parent itself is torn down, its teardown recurses into every registered child automatically. `removeComponent`, on the other hand, only detaches — it does not call `dispose()` or `destructor()`. A component you `removeComponent`'d and are discarding for good still needs an explicit `dispose()` call; nothing does that step for you. Discarding every child at once (a rebuild, not a re-parent) is what `disposeAllComponents()` is for — it disposes each one first.

Closing a [`Tab`](/layouts/Tab) is the one container operation that **does** dispose on the caller's behalf: `Tab.closeTab` (and therefore [`TabPanel`](/components/TabPanel) and [`Dock`](/components/Dock)) `removeComponent`s the closed content and then calls its `dispose()`, unless the tab was registered with `LayoutConstraints.disposeOnClose: false` (or the `DockPanelSpec` / `TabPanel.addTab` equivalent) or a `"tabclose"` listener re-parented the content first. Every other container's removal verb — `removeComponent`, `Split`'s pane collapse, `Accordion`'s section collapse — stays a pure detach.

Because teardown recursion calls `destructor()`, a consumer's own cleanup must live in a `protected destructor()` override on a `Component` subclass — never a `dispose()` method or field on a plain object that merely wraps a `Component`. The wrapper is not in any parent's child list, so nothing ever calls it; an owning `Component`'s `destructor()` must call the wrapper explicitly if the wrapper's cleanup needs to run.

Closing a [`Tab`](/layouts/Tab) is the one container operation that **does** dispose on the caller's behalf: `Tab.closeTab` (and therefore [`TabPanel`](/components/TabPanel) and [`Dock`](/components/Dock)) `removeComponent`s the closed content and then calls its `dispose()`, unless the tab was registered with `LayoutConstraints.disposeOnClose: false` (or the `DockPanelSpec` / `TabPanel.addTab` equivalent) or a `"tabclose"` listener re-parented the content first. Every other container's removal verb — `removeComponent`, `Split`'s pane collapse, `Accordion`'s section collapse — stays a pure detach.

Because teardown recursion calls `destructor()`, a consumer's own cleanup must live in a `protected destructor()` override on a `Component` subclass — never a `dispose()` method or field on a plain object that merely wraps a `Component`. The wrapper is not in any parent's child list, so nothing ever calls it; an owning `Component`'s `destructor()` must call the wrapper explicitly if the wrapper's cleanup needs to run.

Closing a [`Tab`](/layouts/Tab) is the one container operation that **does** dispose on the caller's behalf: `Tab.closeTab` (and therefore [`TabPanel`](/components/TabPanel) and [`Dock`](/components/Dock)) `removeComponent`s the closed content and then calls its `dispose()`, unless the tab was registered with `LayoutConstraints.disposeOnClose: false` (or the `DockPanelSpec` / `TabPanel.addTab` equivalent) or a `"tabclose"` listener re-parented the content first. Every other container's removal verb — `removeComponent`, `Split`'s pane collapse, `Accordion`'s section collapse — stays a pure detach.

Because teardown recursion calls `destructor()`, a consumer's own cleanup must live in a `protected destructor()` override on a `Component` subclass — never a `dispose()` method or field on a plain object that merely wraps a `Component`. The wrapper is not in any parent's child list, so nothing ever calls it; an owning `Component`'s `destructor()` must call the wrapper explicitly if the wrapper's cleanup needs to run.

Closing a [`Tab`](/layouts/Tab) is the one container operation that **does** dispose on the caller's behalf: `Tab.closeTab` (and therefore [`TabPanel`](/components/TabPanel) and [`Dock`](/components/Dock)) `removeComponent`s the closed content and then calls its `dispose()`, unless the tab was registered with `LayoutConstraints.disposeOnClose: false` (or the `DockPanelSpec` / `TabPanel.addTab` equivalent) or a `"tabclose"` listener re-parented the content first. Every other container's removal verb — `removeComponent`, `Split`'s pane collapse, `Accordion`'s section collapse — stays a pure detach.

Because teardown recursion calls `destructor()`, a consumer's own cleanup must live in a `protected destructor()` override on a `Component` subclass — never a `dispose()` method or field on a plain object that merely wraps a `Component`. The wrapper is not in any parent's child list, so nothing ever calls it; an owning `Component`'s `destructor()` must call the wrapper explicitly if the wrapper's cleanup needs to run.

Closing a [`Tab`](/layouts/Tab) is the one container operation that **does** dispose on the caller's behalf: `Tab.closeTab` (and therefore [`TabPanel`](/components/TabPanel) and [`Dock`](/components/Dock)) `removeComponent`s the closed content and then calls its `dispose()`, unless the tab was registered with `LayoutConstraints.disposeOnClose: false` (or the `DockPanelSpec` / `TabPanel.addTab` equivalent) or a `"tabclose"` listener re-parented the content first. Every other container's removal verb — `removeComponent`, `Split`'s pane collapse, `Accordion`'s section collapse — stays a pure detach.

Because teardown recursion calls `destructor()`, a consumer's own cleanup must live in a `protected destructor()` override on a `Component` subclass — never a `dispose()` method or field on a plain object that merely wraps a `Component`. The wrapper is not in any parent's child list, so nothing ever calls it; an owning `Component`'s `destructor()` must call the wrapper explicitly if the wrapper's cleanup needs to run.

Closing a [`Tab`](/layouts/Tab) is the one container operation that **does** dispose on the caller's behalf: `Tab.closeTab` (and therefore [`TabPanel`](/components/TabPanel) and [`Dock`](/components/Dock)) `removeComponent`s the closed content and then calls its `dispose()`, unless the tab was registered with `LayoutConstraints.disposeOnClose: false` (or the `DockPanelSpec` / `TabPanel.addTab` equivalent) or a `"tabclose"` listener re-parented the content first. Every other container's removal verb — `removeComponent`, `Split`'s pane collapse, `Accordion`'s section collapse — stays a pure detach.

Because teardown recursion calls `destructor()`, a consumer's own cleanup must live in a `protected destructor()` override on a `Component` subclass — never a `dispose()` method or field on a plain object that merely wraps a `Component`. The wrapper is not in any parent's child list, so nothing ever calls it; an owning `Component`'s `destructor()` must call the wrapper explicitly if the wrapper's cleanup needs to run.

## See also

- [Mental model](/guide/mental-model) — the architectural overview
- [Layout system](/concepts/layout-system) — how the layout manager actually positions children
- [Sizing](/concepts/sizing) — preferred / min / max size semantics
- [Performance](/concepts/performance) — `pauseLayout`, virtual scrolling, dispose patterns
