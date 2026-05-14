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

**Component additions** (additive):

- **`Glyph`.** A self-contained icon component rendered from a curated registry (`Glyphs.ts`). SVG entries are mounted once as `<symbol>`s into a hidden sprite on `document.body`; each `Glyph` instance emits `<svg><use href="#ts-glyph-…"/></svg>`, so the path data is never duplicated regardless of how many copies of the same glyph are on screen. Unicode entries render as `<span>`. Both forms use `currentColor`, so a `Glyph` inherits the surrounding text colour without any new theme token. New exports from `@jimka/typescript-ui/component/display`: `Glyph` and `GlyphOptions`.
- **`Component.insertComponent(component, index, constraints?)`.** Positional companion to `addComponent`. Inserts a child at the given index, splices it into the framework's children array, and DOM-inserts the element at the matching position. Out-of-range indices are clamped. Use this when child order matters — for example, prepending a leading glyph next to an existing label without the `removeComponent(label) → addComponent(glyph) → addComponent(label)` shuffle.
- **`Glyph` adoption across the library.** [`WindowHeader`](/api/component/container/classes/WindowHeader)'s close button is now an embedded `times` glyph, and `WindowHeader` gains an optional title-icon slot via `setGlyph(name)` / `glyph` option. [`Button`](/api/component/button/classes/Button) (and so [`ToggleButton`](/api/component/button/classes/ToggleButton)) gains an optional leading-glyph slot; [`TabCloseButton`](/api/component/button/classes/TabCloseButton) ships with the `times` glyph pre-seeded. [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton) gains an options bag and an optional leading-glyph slot. [`Tree`](/api/component/tree/classes/Tree) row toggles are now real `Glyph` instances (`arrow-down` / `arrow-right`) rather than raw Unicode characters — the tree row never sees the character, the registry decides the look. A new `glyph` field type plus `GlyphCell` / `GlyphRenderer` make icon columns first-class in [`Table`](/api/component/table/classes/Table).
- **`IconText` and `IconLabel`.** Small composites pairing a [`Glyph`](/api/component/display/classes/Glyph) with a [`Text`](/api/component/input/classes/Text) or [`Label`](/api/component/input/classes/Label). New exports from `@jimka/typescript-ui/component/display`: `IconText`, `IconTextOptions`, `IconLabel`, `IconLabelOptions`.
- **`Window` gains an options bag and a header accessor.** The constructor now accepts an optional trailing `WindowOptions` argument — existing single-argument `new Window(headerText)` call sites continue to compile. The bag carries `headerText` (last-write-wins with the positional argument) and `glyph` (a registry name forwarded to the inner [`WindowHeader`](/api/component/container/classes/WindowHeader)'s title-icon slot). A new `getHeader()` method returns the internal `WindowHeader`, exposing the close button, title text, and title-icon slot to callers who want to wire them up directly. New exported type `WindowOptions` from `@jimka/typescript-ui/core`.
- **`Component.createRootElement()`.** New protected hook called by `render()` to build the root element. Default returns `document.createElement(this.tag)`; subclasses needing a non-HTML namespace (e.g. `Glyph` for SVG) override it.

**Component removals** (breaking — see [Migration](/reference/migration)):

- **`FontAwesomeIcon` removed.** The internal use site ([`WindowHeader`](/api/component/container/classes/WindowHeader)) migrated to [`Glyph`](/api/component/display/classes/Glyph), and the `FontAwesomeIcon` / `FontAwesomeIconOptions` exports, the `@fortawesome/fontawesome-free` peer dependency, the `<script src="…/fontawesome/js/all.js"/>` tags in the bundled HTML, and the asset tree under `src/resources/Base/script/fontawesome/` are all gone. Consumers that were rendering FontAwesome glyphs through `FontAwesomeIcon` should either add the relevant glyph to `Glyphs.ts` and use `Glyph` instead, or render their own `<i class="fa …">` element directly.
- **`TreeRow.getToggle()` return type changed.** Was `Text`; is now `Glyph | null`. Internal-leaning detail — most callers won't notice — but external code that introspected the returned `Text` needs to handle the new shape.

**Data-binding additions** (additive):

- **`Binding.addBeforeRecordListener`.** Registers a synchronous veto listener consulted before `setRecord` mutates any state. Listener returns `false` to cancel the change; iteration short-circuits on the first veto. Use it for programmatic guards such as "refuse to switch records while the current one is dirty". Async confirmation flows still belong at the call site — `setRecord` stays synchronous. New exported type `BeforeRecordListener` from `@jimka/typescript-ui/core`.

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
