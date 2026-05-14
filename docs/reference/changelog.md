# Changelog

Release history. For breaking-change details by version, see [Migration](/reference/migration).

## Unreleased (pre-1.0)

The package is at version `0.0.0` — pre-release, not yet published. Until a `0.x` or `1.0.0` is tagged, anything here may change without a migration note. Highlights below describe work-in-progress capabilities of the development snapshot, not stable contracts.

**Public-API surface**

- 12 layout managers — Border, HBox, VBox, Row, Column, Grid, Split, Tab, Card, Fit, Absolute, Accordion.
- 50+ UI components covering buttons, inputs, lists, menus, dialogs, table, tree.
- Data layer: `Model`, `Store`, `Proxy` (memory + ajax), `ModelRecord`, `Binding`, `Validator`.
- Theme system with light + dark built-in themes and custom-token override support.
- Virtual scrolling in `Table` and `Tree` for large datasets.
- Web Worker offload for store sort / filter on datasets ≥ 1,000 rows.
- Full TypeDoc-generated API reference and curated documentation site.

**Declarative-construction additions** (all additive — every `new X(...)` call site still works):

- **Callable component and layout-manager classes.** Every `Component` subclass, every concrete `LayoutManager`, and `ButtonGroup` can now be invoked without `new` — `Panel({...})` is equivalent to `new Panel({...})`. The classes still satisfy `instanceof` and remain usable as `extends` targets. Backed by a small `callable()` Proxy helper exported from `@jimka/typescript-ui/core`.
- **`components` option on `ComponentOptions`.** Pass a `components: [...]` array to any component constructor and the children are added during construction, after `applyOptions` settles inherited fields.
- **`Component.addComponents(...)`.** Variadic plural alongside `addComponent`. Accepts bare `Component` instances, `ConstrainedComponent` pairs (`{ component, constraints }`), or arrays of either — all forms can be freely mixed.
- **`ConstrainedComponent` interface.** Lifts the `{ component, constraints? }` shape into a reusable type, accepted by both `addComponents` and the `components` constructor option.
- **`ButtonGroup` options + helpers.** `ButtonGroupOptions.buttons` for initial population at construction time; `addButtons(...)` variadic plural; `getComponents()` returns the group's buttons as a `Component[]` for direct hand-off to `addComponents`.

See [Mental model — JSX-shaped, without JSX](/guide/mental-model#jsx-shaped-without-jsx) for the design rationale and [Component options](/recipes/component-options) for the full set of construction patterns.

**Packaging**

- Subpath-only public API. There is no bare `@jimka/typescript-ui` import; consumers import from `@jimka/typescript-ui/<group>` where `<group>` is one of `core`, `primitive`, `layout`, `data`, `validation`, or `component/<sub>`.
- Per-subpath ESM bundles + `.d.ts` declarations emitted to `dist/lib/` (13 bundles, 13 declaration barrels).

## See also

- [GitHub releases](https://github.com/jimka/typescript-ui/releases) — release notes per version with date stamps and contributors.
- [Migration](/reference/migration) — breaking-change details when upgrading between major versions.
