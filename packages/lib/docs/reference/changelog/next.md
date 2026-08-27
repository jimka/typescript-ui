# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Core

`DOMSink` gains one required member: `clearDocumentSelection()`. Only a
consumer implementing its own `DOMSink` is affected.

`DOMSource` gains one required member: `countElements()`. Only a consumer
implementing its own `DOMSource` is affected.

`DOMSource` gains one required member: `getRuleCssText()`. Only a consumer
implementing its own `DOMSource` is affected.

The theme `scale` block's `titleGlyph` and `tabCloseGlyph` tokens are gone,
replaced by a five-step icon scale: `glyphXs` (8px at the default base),
`glyphSm` (12px), `glyphMd` (14px, the old `titleGlyph`), `glyphLg` (16px,
the default icon size), and `glyphXl` (20px). A custom theme that set either
removed token should set `glyphMd` / `glyphXs` instead; a theme that set
neither needs no change.

### Components

- **A table's row-viewport body now loses its old `Body` class and instead
  carries `VirtualRowView` and `TableBody` in its rendered class list; a
  tree table's body keeps its own `TreeBody` class but additionally gains
  `VirtualRowView` and `TableBody` — this is a breaking change for a
  consumer stylesheet selector that targets any of these names.** The
  table-internal class was declared `class Body`, colliding with
  `core/Body`'s app-root singleton (also `class Body`) in the class-tier
  registry's name-keyed lookup; the singleton's eager construction always
  won the name, so the table body always lost and fell back to the
  registry's name-collision opt-out, repeating its full framework baseline
  plus `backgroundColor` on every instance's own `#id` rule on every
  render. The internal declaration is now `TableBody` — the name the docs
  already recommend importing it as — which lets it join the
  hierarchy-aware class tier the same way `Cell`'s built-in subclasses do,
  so its rendered element additionally carries its own ancestor's name
  (`VirtualRowView`), and no longer carries the old bare `Body` name since
  the class actually rendered isn't named that any more. The public export
  (`Body`, from `component/table/index.ts`) is unchanged — only the DOM
  class list changes. **A consumer stylesheet selector targeting `.Body`
  on a table's row-viewport body no longer matches; a new selector
  targeting `.VirtualRowView` or `.TableBody` now does, on both a table's
  and a tree table's body.** Audit any such selector before upgrading.

## Added

### Core

- **`Component.onDestroy(cleanup)`** registers a callback that runs once,
  in registration order, when the component is destroyed — the public
  counterpart of the existing protected `subscribeTheme()` teardown bag,
  for a module outside a component's own class hierarchy that attaches
  state keyed by component identity (e.g.
  [`Tooltip.attach`](/components/Tooltip)) and needs it released on
  teardown. See [Component lifecycle](/concepts/component-lifecycle) for
  the full contract.
- **`Component.registerListenerBag(bag)` and its `LayoutManager` counterpart**
  register a class's own emitted-event `ListenerBag` to be cleared
  automatically on `destructor()` / `detach()`, wrapping the field's own
  initializer (`private _listeners = this.registerListenerBag(new
  ListenerBag())`). Every built-in component and layout manager that emits
  custom events now opts in — see **Fixed** below. See [Component
  lifecycle](/concepts/component-lifecycle) for the full contract.
- **`ListenerBag.clear()`** removes every registered listener across every
  event bucket, crediting the diagnostics overlay's *Semantic listeners*
  count for each one — the primitive `registerListenerBag` is built on.
- **Components can now share a declared style bag across unrelated classes**,
  via `protected static readonly ownStyleTraits` (class-level, inherited down
  the chain) or the new `styleTrait` construction option / `setStyleTrait`
  (instance-level, independent of class). Every opt-in for the same trait
  shares one generated CSS rule. The shared rule outranks a plain class
  default by specificity, so overriding one of its properties on a specific
  class or instance requires an explicit setter call (an authored instance
  value), not just a class-tier default.
- **`ButtonGroup.dispose()` and `Binding.dispose()`** release each class's
  own emitted-event `ListenerBag`. Neither class is a `Component` or
  `LayoutManager`, so neither had a teardown hook to piggyback on — unlike
  `registerListenerBag`'s automatic clearing above, a caller that
  constructs a `ButtonGroup` or `Binding` outside a `Component` tree must
  call `dispose()` itself when done with it. `Binding.dispose()`
  additionally deactivates every field registered via `bind()`, the same
  way `unbind()` already does, so a bound component's listener becomes
  inert rather than writing into a dead binding.

### Components

- **[`Window`](/components/Window) and [`TabWindow`](/components/TabWindow) gain a `resizable` option**, plus the matching `setResizable(value)` / `isResizable()` pair on [`AbstractWindow`](/components/AbstractWindow). Defaults to `true`, so every existing window keeps behaving exactly as it does now. Setting it `false` hides all eight drag-to-resize border strips (no cursor, no hit test at the edges) and disarms the Ctrl-snap resize affordance; moving is unaffected. `resizable` is also the master switch for `minimizable` / `maximizable`: a non-resizable window can be neither minimized nor maximized by the user regardless of those two flags, and `isMinimizable()` / `isMaximizable()` report this *effective* value. Each flag's own setting is remembered underneath and takes effect again once `resizable` is re-enabled.
- **[`DiagnosticsOverlay`](/components/DiagnosticsOverlay)**, a floating
  window showing live runtime diagnostics — FPS, JS heap, DOM node count and
  long tasks alongside framework-internal numbers (live `Component` count,
  layout passes and flush time, DOM/semantic listener registrations,
  per-instance stylesheet rule count). Open it with
  `DiagnosticsOverlay.open()`. It ships as its own subpath,
  `@jimka/typescript-ui/diagnostics`, so an app that never imports it never
  bundles a byte of the overlay UI. The pushed counters it reads live in the
  always-loaded core chunk — one integer increment at seams the framework
  already runs on every request, so the always-on cost is negligible even
  when the overlay is never opened.
- **[`DiagnosticsOverlay`](/components/DiagnosticsOverlay) now explains what
  each metric row measures** as a hover tooltip on both the row's label and
  its number — e.g. *Layout passes* now reads as a raw `doLayout()` call
  count, not a cost figure. [`LabeledGrid`](/components/LabeledGrid) and
  [`LabeledFieldSet`](/components/LabeledFieldSet) gain a matching optional
  `description` on `addField` / row descriptors, attached the same way. Both
  are additive — every existing call still compiles unchanged.
- **[`StyleAuditOverlay`](/components/StyleAuditOverlay)**, a floating window
  showing the stylesheet dedup audit: per-instance (`#id`-scoped) rules whose
  declaration body duplicates another instance's, ranked by bytes wasted.
  Open it with `StyleAuditOverlay.open()`, or from
  [`DiagnosticsOverlay`](/components/DiagnosticsOverlay)'s new "Show style
  audit" button. It ships as its own subpath, `@jimka/typescript-ui/diagnostics`,
  alongside `DiagnosticsOverlay`. Unlike `DiagnosticsOverlay`'s live sampler,
  it computes the audit once when opened and again only on an explicit
  Refresh click. Because `DiagnosticsOverlay` imports it directly to wire that
  button, an app that already bundles `DiagnosticsOverlay` now also bundles
  `StyleAuditOverlay`'s `Table` and `MemoryStore` dependencies, whether or not
  it ever calls `StyleAuditOverlay.open()` itself.
- **`TextField` (and `TextArea`/`PasswordField`/`UsernameField`/`PickerInput`,
  via `TextInput`), `DateField`/`TimeField`/`DateTimeField` (via
  `AbstractPickerField`), `ComboBox`, and `FieldSet` now additionally carry a
  `ts-ui-trait-input-chrome` class on their rendered element**, and their
  border/border-radius declarations move from each class's own rule onto one
  shared rule (see the new trait mechanism above). **This inverts a
  previously order-dependent case: a consumer stylesheet rule of the form
  `.TextInput { border: … }` — previously a toss-up decided by stylesheet
  load order, since both the framework's and a consumer's own `.TextInput`
  rule sat at the same specificity — now reliably loses to the framework's
  own, higher-specificity trait rule.** A consumer relying on overriding this
  border via a plain class selector must raise its own selector's
  specificity (e.g. two classes, or an id) to keep winning.

## Changed

### Components

- **The table header's column and filter rows now touch only the columns
  entering or leaving the visible window during an ordinary horizontal
  scroll**, instead of re-deriving every rendered cell's state on every
  tick. A resize, a column-set change, or a jump larger than the visible
  window still reconciles the whole window as before. No consumer action is
  needed.
- **`SelectableListRow` no longer duplicates its fixed padding on every
  instance's own CSS rule.** It now shares one CSS rule across every
  instance in the app. Nothing changes visually; no consumer action needed.
- **Every `AccordionHeader` in a themed accordion now shares one CSS rule
  for its background, text colour, and border instead of repeating them on
  every instance's own `#id` rule.** Nothing changes visually; no consumer
  action needed.
- **`TextField`, `TextArea`, `PasswordField`, `UsernameField`,
  `AbstractPickerField` (`DateField`/`TimeField`/`DateTimeField`), and
  `BulletedList`/`NumberedList` now render with the padding they were always
  configured with, but which a resolver gap silently dropped.** Text fields
  gain a 3px inset around their typed text on every side; the marker-list
  classes are unaffected in practice (their layout already accounted for the
  padding). If a consumer's own stylesheet compensated for the
  previously-missing padding, that compensation should be revisited.
- **`Spacer`, `CollapseButton`, `ProgressSpinner`, and `ParentHeaderCell` no
  longer duplicate their fixed styling on every instance's own CSS rule.**
  Each now shares one rule per piece across every instance in the app.
  Nothing changes visually; no consumer action needed.
- **A progress spinner's inner arc element now carries a `ProgressSpinnerArc`
  class** (`ts-ui-component ProgressSpinnerArc`, previously `ts-ui-component`
  alone). This is additive — no existing class is removed — but a consumer
  stylesheet selector written to match the arc by position rather than by
  name may now also be matched by a more specific `.ProgressSpinnerArc` rule.

### Table

**Horizontal scrolling to either end of a wide table is no longer slower
than scrolling through its middle.** The rendered column window keeps a
constant width at every scroll offset, so reaching the first or last
columns no longer forces every visible row to re-derive its whole cell
set. A few more columns are rendered when the table is scrolled hard
against either end — the same number it renders mid-scroll. No consumer
action is needed.

**A table with `autoSizeColumns: true` now re-samples its column widths on
every later data change — a load, an add, a remove, or an in-cell edit —
instead of freezing them after the first non-empty sample.** Widths widen to
fit a longer value added later and narrow again once it is removed or
edited down, coalesced to at most one layout pass per animation frame so a
burst of changes still costs a single re-derivation. A column the user
drag-resized is now pinned: it keeps the width the drag left it at through
every later re-sample, instead of being overwritten by the next one. No
consumer action is needed.

## Fixed

### Core

- **`Component.clearBackgroundImage()` now respects a Button-family
  instance's resting-chrome isolation instead of writing straight to the
  bare instance rule.** The neutral assertion previously always landed on
  the unguarded `#id` rule, which could silently override an isolated
  instance's `.pressed`/`:hover` background-image — visible on
  `Notification`'s close button, which gains the same hover/pressed
  background-image clears `Dialog`'s close button already had. No consumer
  action is needed.
- **A component that had [`Tooltip.attach`](/components/Tooltip) (or
  `attachToElement`) called on it now releases that attachment when the
  component is destroyed, instead of leaking it — and everything it
  retains — forever.** `Tooltip` had no teardown hook at all: every
  `Button` with a title, every table header cell with a column
  description, and several other built-in components attach a tooltip
  with nothing to release it, so destroying any of them left the
  attachment's listener closure (and, through it, the whole destroyed
  subtree) permanently reachable from `Tooltip`'s static registry.
  Confirmed live via heap snapshot: a table's header-menu-button tooltip
  alone was enough to pin every disposed `Table`/`Row`/`Cell` under it.
  Fixed via the new `Component.onDestroy()` hook (see **Added** above);
  no consumer action is needed.
- **`Table`, `TableBody`, `TablePanel`, `TreeTablePanel`,
  `AbstractSelectableList` (`List` / `MultiSelectList`), and `ComboBox` now
  unsubscribe from their bound `AbstractStore` when disposed, instead of
  leaking the subscription for as long as the store lives.** A store is
  owned by the caller, not the component displaying it, and routinely
  outlives any one view of it (a shared data store, a re-opened dialog); an
  un-unsubscribed `store.on('load', …)`-style listener kept the disposed
  component (and everything it retains) reachable from the store's own
  `ListenerBag` indefinitely. `Table` and `AbstractSelectableList` already
  had the unbind logic wired for their own *re-bind* path (`setStore`) but
  never called it from `destructor()`; `TableBody`, `TablePanel`,
  `TreeTablePanel`, and `ComboBox` had no unbind at all. No consumer action
  is needed.
- **`ComboBox`, `AutoCompleteField`, and the picker-field family (`DateField`
  / `DateTimeField` / `TimeField`, via `AbstractPickerField`) now dispose
  their dropdown when the field itself is destroyed.** Each field's dropdown
  is a `Position.FIXED` overlay — like `Tooltip`'s singleton, never a
  registered child — that none of these classes had a `destructor()` for at
  all, so it, its inner list, and (for `ComboBox`) that list's own store
  subscription outlived the field. No consumer action is needed.
- **Every built-in component or layout manager that emits its own custom
  events (`Table`, `Header`, `Body`, `Cell`, `Tab`, `Tree`, `Scrollbar`,
  `TabBar`, `AbstractChart`, `CodeEditor`, and roughly two dozen more) now
  clears its `ListenerBag` when destroyed, via the new
  `registerListenerBag` (see **Added** above), instead of leaving whatever a
  consumer subscribed permanently counted as "added" with no matching
  "removed."** This was invisible as a real memory leak — the listeners
  were reclaimed by GC along with everything else once a subtree was truly
  unreachable — but it permanently inflated the diagnostics overlay's
  *Semantic listeners* count on every dispose, so the count no longer meant
  "currently live," only "ever added." Confirmed live: 10 open/close cycles
  of a 10,000-row `Table` (`bench.benchRowSelect()`) previously grew the
  count by 1,790; it now returns to baseline every time. No consumer action
  is needed.
- **`clearForegroundColor()` now clears the colour instead of handing it
  back to the class rule on a class that defaults `foregroundColor`.** No
  consumer action is needed.

### Components

- **`MenuBarButton` and `TabCloseButton` regain their own background /
  foreground tokens.** Both forwarded a hoistable colour default through
  `subclassDefaults` without registering their own `ownClassStyleDefaults`,
  so the hierarchy-aware class tier silently replaced their colours with
  `Button`'s once the shared class rule resolved at first render. No
  consumer action is needed.
- **A selected `TabButton` now reports its own white fill from
  `getBackgroundColor()`, instead of `ToggleButton`'s grey.** The CSS
  already painted the correct colour; the JS-side layer stack now agrees
  with it. No consumer action is needed.
- **The shared window-control button factory, `MenuBarButton`'s hover
  highlight, and `TabCloseButton`'s resting/hover chrome now dedupe onto
  shared class rules instead of repeating on every instance.** No consumer
  action is needed; nothing renders differently.
- **Every `Table`'s row-viewport body now dedupes its resting background
  colour onto a shared `.TableBody` class rule instead of repeating the full
  framework baseline plus `backgroundColor` on every instance's own `#id`
  rule.** The table-internal class was declared `class Body`, colliding with
  `core/Body`'s app-root singleton (also `class Body`) in the class-tier
  registry's name-keyed lookup; the singleton's eager construction always
  won the name, so the table body always lost and fell back to the
  registry's name-collision opt-out. The internal declaration is now
  `TableBody` — the name the docs already recommend importing it as — while
  the public export (`Body`, from `component/table/index.ts`) is unchanged.
  See **Breaking changes** above for the resulting rendered-DOM class list
  change.
- **A flat `Button`'s resting chrome (border, shadow, background) now
  dedupes onto one shared class rule instead of repeating on every
  instance, matching the pressed/hover dedup already shipped.** A flat
  button's border colour now correctly changes on hover/press — previously
  it stayed transparent in every state because an unguarded per-instance
  write silently outranked the state rules. No consumer action is needed,
  beyond the corrected border colour.
- **The table header's column-menu button's hover/pressed background now
  shows the intended light-gray tint instead of a translucent overlay.**
  The button drops `flat` mode in favour of its own declared chrome (a new
  `TableHeaderMenuButton` subclass), which also dedupes its resting/pressed/
  hover chrome onto shared class rules. No consumer action is needed.
- **`PickerButton` and `AccordionHeader`'s section title button now dedupe
  their resting, pressed, and hover chrome onto shared class rules instead of
  repeating on every instance.** No consumer action is needed; nothing
  renders differently.
- **A `Rail`'s handles now show their selected tint when the handle's
  drawer is open or its window is restored — previously the tint was
  masked by the handle's own resting rule and never rendered.** The
  handles also dedupe their resting, pressed, hover, and selected chrome
  onto shared class rules instead of repeating on every instance. No
  consumer action is needed.
- **`NumberSpinner`'s up/down spin buttons now dedupe their border onto
  shared class rules instead of repeating it on every instance.** No
  consumer action is needed; nothing renders differently.
- **`NumberSpinner`'s spin buttons now dedupe their pressed box-shadow onto a
  shared class rule instead of repeating it on every instance.** No consumer
  action is needed; nothing renders differently.
- **`Slider`'s track, active-track, and thumb now dedupe their static chrome
  (`backgroundColor`/`borderRadius`/`border`/`shadow`/`maxSize`) onto shared
  class rules instead of repeating on every instance's own `#id` rule.** No
  consumer action is needed; nothing renders differently.
- **`Toggle`'s track and thumb now dedupe their resting chrome onto shared
  class rules the same way, and the track's checked "on" fill is now a
  declared `.selected` style state on the shared rule instead of an
  imperative background-colour write on every toggle.** No consumer action
  is needed; nothing renders differently.
- **`ListItem`'s marker text now dedupes its right-aligned `text-align`
  declaration onto a shared class rule, instead of repeating on every list
  item's own `#id` rule.** No consumer action is needed; nothing renders
  differently.
- **`RadioButtonRing`'s round corner, `BulletedList`/`NumberedList`'s marker
  suppression, `Legend`'s in-flow positioning, and `ParentHeaderCell`'s
  group-label styling (bold/centered/unselectable) no longer duplicate their
  fixed styling on every instance's own CSS rule.** Each now shares one CSS
  rule per piece across every instance in the app — `RadioButtonRing` and
  `Legend` through the class-tier default mechanism, the two marker lists
  through a new shared `.MarkerList` class rule, and `ParentHeaderCell`
  through two new internal subclasses mirroring `HeaderCell`'s own text/
  renderer shape. Nothing changes visually; no consumer action needed.
- **A table `Cell`'s `setBaseBackground` tint (e.g. a grouped column's
  `groupColor`) now actually dedupes onto its shared `.Cell.bg<color>` class
  rule instead of also writing its own `#id` declaration on top of it.** The
  shared rule was already created but never compared against, so the
  per-instance declaration it was meant to replace kept winning on
  specificity — the Style Audit's single largest duplicate-rule group. This
  also fixes a real correctness bug: once a cell rendered with one base
  colour, a later `setBaseBackground` rebind (as happens on every pooled
  row/column recycle) never rewrote that per-instance declaration, so a
  recycled cell could keep painting its first colour after being reused for
  a different grouped column. No consumer action is needed, beyond the
  corrected recycle-time colour.
- **`List` and `MultiSelectList` now dedupe their default 100×100 minimum
  size onto the shared `.AbstractSelectableList` class rule instead of
  repeating `min-width`/`min-height` on every list's own `#id` rule.** A
  caller-supplied `minSize` still wins, and every list keeps the same
  minimum it had before. No consumer action is needed; nothing renders
  differently.

### Table

Selecting text inside a single cell works again, and Ctrl/Cmd+C copies that
text; the cell-range drag now takes over only once the drag crosses into
another cell.

## Changed

### Core

- **`clearOutline`, `clearOverflowX`, and `clearOverflowY` now suppress the
  class-tier default instead of re-resolving it.** Previously, clearing one
  of these after an explicit override fell back to whatever the class
  itself defaults to (e.g. a class defaulting `overflow: "auto"`); the
  getter now reports `null` instead, matching `clearBackgroundColor` and
  every other `clearX` setter's existing "cleared means cleared, not
  reverted to the class default" contract. The rendered CSS is unaffected
  either way — the class-tier rule still supplies the value visually — only
  the getter's own answer changes for a caller that reads it back.
- **Every declared toggle state (`Button`'s `.pressed`/`:hover`,
  `ToggleButton`'s `.selected`, `Checkbox`'s `.selected`/`.indeterminate`,
  and similar) now shares one class-tier CSS rule across every instance in
  that state, instead of each instance's `#id` rule repeating the same
  declarations.** This shrinks the generated stylesheet's size, most
  visibly on a Table or Tree with many rows sharing the same selected /
  dirty / new / read-only / required-empty tint. The *rendered* result is
  unchanged, and every existing `setPressedX`/`setSelectedX`-style
  per-instance override still applies on top of the shared default exactly
  as before. One consumer-visible consequence: every layering getter
  (`getBackgroundColor`, `getForegroundColor`, `getOutline`, `getShadow`,
  and similar) now resolves whichever declared state is currently active on
  that instance, not only its resting value — e.g. `button.getShadow()` on
  a pressed button now returns the pressed shadow, where it previously
  always answered the resting one regardless of press state. No consumer
  action is needed unless code reads one of these getters and assumed it
  ignored active toggle state.
- **A per-instance state override (`Button`'s `setPressedX`/`setHoverX`,
  `ToggleButton`'s `setSelectedX`, and similar) now resolves through the
  same layer stack as every other property**, instead of a separate
  per-property cache: `button.getBackgroundColor()` on a pressed button now
  reports a `setPressedBackgroundColor` override while `.pressed` is
  active, where it previously always answered the resting value regardless
  of press state. Two consumer-visible consequences: a state override
  written at exactly the class-tier token now emits an explicit removal
  rather than being silently skipped, so it still clears an earlier,
  differently-valued override on the same property; and a `clearPressedX`
  getter (e.g. `getPressedBackgroundColor()` after
  `clearPressedBackgroundColor()`) now reports the pinned resting value it
  just wrote, not the class-tier default. No consumer action is needed
  unless code reads one of these getters and assumed it ignored active
  toggle state, or relied on a matching write being silently dropped.
- **The shared `<style id="Base">` stylesheet now dedupes `Button`'s hover
  chrome, flat-mode pressed/hover chrome, and `TabButton`'s hover/selected
  borders, the same way `.pressed` already deduped.** No consumer action is
  needed.
- **`Component.setVisible(false)` and `Scrollbar`'s overflow-driven
  `setDisplayed(false)` now share one class-tier CSS rule (`.invisible`,
  `.undisplayed`) across every hidden or undisplayed instance, instead of
  each instance's `#id` rule repeating its own `visibility`/`display`
  declaration.** These were the Style Audit's single biggest duplicate-body
  rows, since roughly half of all live instances are hidden or undisplayed
  at any moment. The rendered result is unchanged. No consumer action is
  needed.
- **The CSS `background` shorthand now participates in the layered style
  bag, the same way `backgroundColor` / `backgroundImage` already do.**
  `getBackground()` now folds the class and group tiers instead of
  reporting only what this instance set, `setBackground()` dedupes against
  a class-level default, and `clearBackground()` asserts `background:
  transparent` when the class declares one. A consumer that called
  `getBackground()` on an instance of a class with a class-level
  `background` and relied on the `null` return is affected.

### Components

- **A `ToggleButton` that is both selected and pressed now resolves its
  `.pressed` chrome, not `.selected`.** The two states were not previously
  ordered relative to each other for a control that could be in both at
  once (an unusual but reachable combination — press-and-hold on an
  already-selected toggle); `.pressed` now wins wherever the two declare
  the same property. No consumer action is needed.

- **A sort applied any way other than clicking a column header — a
  programmatic `AbstractStore.sort()`/`clearSort()`, or a display-mode swap
  to a store whose sort already differs — could leave a header cell showing
  a stale sort indicator, or none at all, until the next unrelated
  reconcile happened to sweep it back into sync.** `TableHeader` had no
  subscription to the store's `'sortchange'` event; the correct indicator
  only ever appeared as an incidental side effect of some other full
  reconcile. It now subscribes directly, mirroring the header's existing
  `'filterchange'` subscription. No consumer action is needed.

- **On a flat `Button`, `getPressedBackgroundColor()` / `getPressedShadow()`
  / `getHoverBackgroundColor()` now report the non-flat class default rather
  than the flat token, and `getPressedBorder()` / `getHoverBorder()` now
  report `null`; a flat, selected `ToggleButton`'s
  `getSelectedBackgroundColor()` / `getSelectedShadow()` have the same
  class-default change.** The actual rendered chrome is unchanged — only
  what these getters report on a flat instance. No consumer action is
  needed unless code reads one of these getters on a flat instance and
  assumed it returned the flat token.
- **On a flat `Button`, `getBorder()` / `getBorderRadius()` / `getShadow()`
  / `getBackgroundImage()` / `getBackgroundColor()` now report the non-flat
  class default rather than the flat token**, extending the same
  class-default change above to the resting tier. The actual rendered
  chrome is unaffected — only what these getters report on a flat instance.
  No consumer action is needed unless code reads one of these getters on a
  flat instance and assumed it returned the flat token.
- **`TextField`, `TextArea`, `PasswordField`, `UsernameField`, and the picker
  fields' inner input no longer repeat their font declarations on every
  instance's own CSS rule.** `font-family`, `font-size`, and `line-height`
  now come from one shared `.TextInput` rule. Nothing changes visually. Two
  consumer-visible consequences for `getTextAlign()` on a text input: it now
  resolves the class-tier default when its class declares one (no built-in
  class did before, so every existing class answers as it did), and
  `clearTextAlign()` on such a class reverts to that default rather than
  removing alignment entirely — matching `clearCursor` and every other
  layered `clearX`.
- **The triangle glyph inside a `Scrollbar`'s arrow buttons no longer
  repeats its font-size/line-height/text-align on every instance's own CSS
  rule.** These three properties now flow through the same shared
  class-tier mechanism `Glyph`'s size already used, instead of a raw,
  per-instance-only write. Nothing changes visually — every scrollbar's
  arrows render identically — the shared `.ScrollArrowGlyph` rule grows by
  three declarations and every instance's own rule shrinks by the same
  three. No consumer action is needed.
- **A `ComboBox`'s collapsed label now paints its `line-height` through a
  CSS rule shared by every ComboBox resolving the same line box, instead
  of each control writing its own.** The line box is theme-derived, so
  every ComboBox on a page normally resolves the same value; previously
  each one repeated that declaration in its own rule. No consumer action
  needed; nothing changes visually.
- **`FileField`'s hidden native input, `FooterRow`, `TableHeader`, `Table`,
  and `ToolBar` (horizontal/default orientation) no longer duplicate their
  fixed styling on every instance's own CSS rule.** Each now shares one CSS
  rule per piece across every instance in the app. Nothing changes visually;
  no consumer action needed.
- **A rendered `TreeTable` element now additionally carries the `Table`
  class** (`ts-ui-component Table TreeTable`, previously `ts-ui-component
  TreeTable`). A consumer stylesheet selector targeting bare `.Table` —
  previously matching no `TreeTable` element — now matches `TreeTable` too.
  Audit any such selector before upgrading.
- **A rendered `ToolBar` element now additionally carries the `Container`
  class** (`ts-ui-component Container ToolBar`, previously `ts-ui-component
  ToolBar`). A consumer stylesheet selector targeting bare `.Container` —
  previously matching no `ToolBar` element — now matches `ToolBar` too.
  Audit any such selector before upgrading.
- **`Button`'s leading icon no longer repeats its fixed size on every instance's own CSS rule; a `NumberSpinner`'s arrows, a closeable tab's ✕, a `WindowHeader`'s title icon, and a `ComboBox`'s chevron no longer repeat theirs either.** The leading icon still shares one class-level rule (`.ButtonIconGlyph`). The spinner arrows and the tab ✕ now share one CSS rule across both — `.ts-ui-component.ts-ui-trait-glyph-xs-ink` — instead of each owning its own `styleGroup` rule (`.ButtonIconGlyph--spin-glyph`, `.ButtonIconGlyph--tab-close-glyph`); the window title icon and the combo chevron now share one CSS rule across both — `.ts-ui-component.ts-ui-trait-glyph-md-ink` — instead of each owning its own class rule (`.WindowHeaderTitleGlyph`, `.ComboBoxCaretGlyph`). A table's header menu icon is unchanged, still on its own `.ButtonIconGlyph--table-header-menu-glyph` `styleGroup` rule (its size comes from an unrelated, fixed-scrollbar-width formula, not a named icon step). Nothing changes visually. No consumer action is needed.
- **`TextField` and every class built on it no longer duplicate their
  `min-height`/`max-height` CSS declarations in two different property
  orders.** Every `AbstractInput` text control's own CSS rule now writes
  `max-height` before `min-height`, matching `PasswordField`/`UsernameField`/
  `ComboBox`/the picker fields, which already did. `NumberSpinner`'s and
  `AutoCompleteField`'s inner fields also no longer repeat their borderless
  chrome (`border: none`, `border-radius: 0`, `outline: none`) on every
  instance's own rule — it now comes from one shared class rule each
  (`.NumberSpinnerField`, and a new `.AutoCompleteTextField`). Nothing
  changes visually; only which CSS rule supplies each declaration. No
  consumer action is needed.
- **Every framework icon that previously hardcoded its pixel size now reads
  one of five named icon steps** (`glyphXs`/`glyphSm`/`glyphMd`/`glyphLg`/
  `glyphXl` — see **Breaking changes** above), so raising `scale.base` scales
  icons along with the rest of the chrome. Sizes under the shipped themes are
  unchanged. The icons still sized against a fixed host graphic — a scrollbar
  arrow and a table header's menu icon, both pinned to `Scrollbar`'s
  `TRACK_WIDTH` track-width constant, an ergonomic touch-target quantity
  investigated and confirmed independent of the icon scale — and a `Button`'s
  leading icon, which tracks its own label's line box, are deliberately not
  on the scale.
- **A `Checkbox`'s box and check mark, and a `RadioButton`'s ring and dot,
  now read the `glyphLg`/`glyphSm`/`glyphXs` icon steps** instead of
  hardcoded 16/12/8px literals, so both grow under a raised `scale.base`.
  The ink-centring offset that places the check/dot (and, for `Checkbox`,
  its indeterminate dash) inside the box is now computed from the box and
  ink sizes rather than a fixed pixel, so it stays centred at any base.
  Sizes under the shipped themes are unchanged.
