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

**UX polish pass — code review** (additive + small breaking renames):

- **`Animation` utility** (`@jimka/typescript-ui/core`). `Animation.play(el, config)` drives an entrance or exit transition on a DOM element — applies optional `from` styles, double-RAF-flushes, then transitions to `to` over `durationMs` and fires `onComplete` on `transitionend` (with a fallback timeout). Used by [`Notification`](/api/core/classes/Notification) and [`Dialog`](/api/core/classes/Dialog) so the two-RAF flush and `transitionend`-with-fallback bookkeeping live in one place. `Animation.isReducedMotion()` is exposed for callers that need to branch UI on the same predicate.
- **`Button` accepts an options bag as the first argument.** `new Button({ glyph: 'times' })` is now equivalent to `new Button(undefined, { glyph: 'times' })`. The constructor now also rejects a button with neither text nor glyph at runtime, so misconfigured callers fail fast instead of rendering an empty `<button>`.
- **`DialogTitleBar#getText()` renamed to `getTitleText()`.** Reach via `Dialog#getTitleBar()`. The old name lived briefly during the polish pass; only the notification-detail path inside the library was a consumer.
- **`MENU_BAR_BUTTON_HEIGHT`** is now a documented constant in `component/menubar/MenuBarButton.ts`, shared by [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton)'s `centerInHeight` / `setPreferredSize` and [`MenuBar`](/api/component/menubar/classes/MenuBar)'s `setMinSize` so the row height is no longer a triple-coded `28`.
- **Glyph registry alphabetised** in `Glyphs.ts` and `NOTICE`.
- **SpinButton glyph nudged 1 px up** via `setTranslate` to compensate for subpixel rounding in the half-height button's centring math.

**Floating-component entrance/exit fades** (additive):

- Every floating overlay built on top of [`Animation`](/api/core/classes/Animation) now plays a matching entrance/exit transition: [`Window`](/api/core/classes/Window) (150 ms fade + scale, same feel as [`Dialog`](/api/core/classes/Dialog)), [`Menu`](/api/core/classes/Menu) (120 ms fade, both right-click rebuild mode and `MenuBar` persistent mode), [`Tooltip`](/api/core/classes/Tooltip) (100 ms fade), and [`AutoCompleteDropdown`](/api/component/input/classes/AutoCompleteDropdown) (100 ms fade). All four honour `prefers-reduced-motion: reduce` and handle a fresh `show()` mid-fade-out by cancelling the deferred `removeElement`.
- [`Tab`](/api/layout/classes/Tab) layout fades the newly-selected tab's content in over 120 ms whenever the selection changes (idempotent — pure relayouts like a window resize don't re-trigger it).

**UX polish pass — visual review** (additive):

- **Entrance animations** on [`Notification`](/api/core/classes/Notification) (slide-in from right + fade, 200ms) and [`Dialog`](/api/core/classes/Dialog) (fade + scale-up from 0.97, 150ms, backdrop fades in lockstep). Both honour `prefers-reduced-motion: reduce`.
- **2px default glyph-text spacing** on [`Button`](/api/component/button/classes/Button), [`IconText`](/api/component/display/classes/IconText), and [`IconLabel`](/api/component/display/classes/IconLabel). Pass an explicit `gap` to override.
- **Empty-text Text now reports null baseline**, so HBox no longer baseline-aligns glyph-only buttons against neighbouring text. Fixes [`PaginationBar`](/api/component/display/classes/PaginationBar) where `Page x of y` sat above the nav buttons.
- **Dialog/Notification close-button glyph** explicitly relayouts the button after position changes so its internal Fit/HBox cascades sizes to the times glyph.

**UX polish pass** (additive):

- **Glyph registry expansion.** Added 18 new entries: `chevron-up`, `chevron-down`, `plus`, `minus`, `sync`, `ban`, `angle-left`, `angle-right`, `angles-left`, `angles-right`, `info-circle`, `check-circle`, `triangle-exclamation`, `circle-exclamation`, `window`, `file`, `pen-to-square`, `eye`. SVG path data sourced from Font Awesome Free (CC BY 4.0) — attribution in `NOTICE`.
- **Glyph adoption across library buttons.** [`SpinButton`](/api/component/input/classes/SpinButton) now renders `chevron-up` / `chevron-down` SVG glyphs (previously Unicode `▲` / `▼`). [`TablePanel`](/api/component/table/classes/TablePanel)'s toolbar buttons swap to `plus` / `minus` / `sync` / `ban` glyphs with hover tooltips. [`PaginationBar`](/api/component/display/classes/PaginationBar)'s nav buttons swap to `angles-left` / `angle-left` / `angle-right` / `angles-right`. [`Dialog`](/api/core/classes/Dialog)'s title-bar close icon is now a `Button({ glyph: "times" })`.
- **Default `Window` title icon.** `new Window("…")` with no options now defaults to a `window` glyph in the title bar. Pass `{ glyph: null }` to opt out, or `{ glyph: "file" }` (etc.) to override.
- **`Text#centerInHeight(px)`.** Helper that sets `line-height` equal to the given pixel height so a single-line text sits vertically centred. Pass `null` to revert to the theme multiplier. Used by [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton) and [`DialogTitleBar`](/api/core/classes/DialogTitleBar) to fix recurring top-of-box text symptoms.
- **`MenuBarButton` measured preferred width.** The hard-coded `length * 7 + pad` estimate is replaced by `_text.getPreferredSize().width`, so wider characters (e.g. "View") no longer clip on the right.
- **`MenuConfig.glyph`.** Optional registry glyph name displayed to the left of each top-level [`MenuBar`](/api/component/menubar/classes/MenuBar) button label.
- **Notification severity badges.** Every [`Notification`](/api/core/classes/Notification) now leads with an SVG glyph tinted by its severity (`info-circle` / `check-circle` / `triangle-exclamation` / `circle-exclamation`).
- **Notification two-line clamp + double-click detail.** Long messages clamp to two lines with `…`; double-clicking the toast opens a modal [`Dialog`](/api/core/classes/Dialog) showing the full content with a colour-tinted, glyph-decorated title bar.
- **`Notification.pauseAll()` / `Notification.resumeAll()`.** Static helpers that pause/resume every active auto-dismiss timer. Wired in automatically by the detail-dialog flow; exposed publicly so consumer modal flows can wrap their `Dialog.show()` with the same pair. `resumeAll()` clamps remaining duration to a minimum of 8 seconds.
- **Slide-fade notification dismiss / fade-only dialog dismiss.** 200ms `translateX(100%)` + `opacity 0` for notifications; 150ms `opacity 0` + `scale(0.97)` for dialogs (backdrop fades in lockstep). Both honour `prefers-reduced-motion: reduce` — the transition is skipped and the element removed synchronously.
- **`Dialog.getTitleBar()` / [`DialogTitleBar`](/api/core/classes/DialogTitleBar) public.** New accessor returns the dialog's title-bar component so callers can tint the background, change the title-text colour, or mount a leading glyph. Used internally by the notification detail dialog; available to consumer code for custom theming.

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
