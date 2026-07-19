# Concepts

Deep-dive guides to the framework's foundations. Read these before using non-trivial features.

If you are new here, start with the [mental model](/guide/mental-model) in the Guide section first.

## Pages

- [Component lifecycle](/concepts/component-lifecycle) — construction, render, `doLayout`, dispose.
- [Constructing components](/concepts/construction) — callable shorthand, options bags, and which exports need `new`.
- [Layout system](/concepts/layout-system) — how `LayoutManager` resolves fill / anchor constraints.
- [Sizing](/concepts/sizing) — preferred / min / max / fixed sizes.
- [Events](/concepts/events) — `addListener` vs `addSubtreeListener`, hover quirks.
- [Layering](/concepts/layering) — the runtime layer tree, z-index bands, and dismiss modes behind overlays.
- [Theming](/concepts/theming) — design tokens, custom themes, theme-change listeners.
- [Data binding](/concepts/data-binding) — Model / Store / Proxy / `Binding` overview.
- [Accessibility](/concepts/accessibility) — ARIA, keyboard navigation, `RovingTabIndex`.
- [Performance](/concepts/performance) — `pauseLayout`, virtual scrolling, dispose patterns.
- [DOM seams](/concepts/dom-seams) — the swappable `DOMSink` / `DOMSource` write and read boundary behind offline geometry tests.

If you are building custom components or layouts, the **lifecycle**, **layout system**, and **events** pages are the load-bearing reading. For app-level work, **theming** and **data binding** are the most useful entry points.
