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

### Components

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

## Changed

### Components

- **The table header's column and filter rows now touch only the columns
  entering or leaving the visible window during an ordinary horizontal
  scroll**, instead of re-deriving every rendered cell's state on every
  tick. A resize, a column-set change, or a jump larger than the visible
  window still reconciles the whole window as before. No consumer action is
  needed.

### Table

**Horizontal scrolling to either end of a wide table is no longer slower
than scrolling through its middle.** The rendered column window keeps a
constant width at every scroll offset, so reaching the first or last
columns no longer forces every visible row to re-derive its whole cell
set. A few more columns are rendered when the table is scrolled hard
against either end — the same number it renders mid-scroll. No consumer
action is needed.

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
- **`Button`'s leading icon, a `ComboBox`'s chevron, and a `WindowHeader`'s
  title icon no longer repeat their fixed size on every instance's own CSS
  rule; a `NumberSpinner`'s arrows, a closeable tab's ✕, and a table's
  header menu icon no longer repeat theirs either.** The first three now
  share one class-level rule each (`.ButtonIconGlyph`,
  `.ComboBoxCaretGlyph`, `.WindowHeaderTitleGlyph`); the second three now
  use the `styleGroup` mechanism to share a rule per owner
  (`.ButtonIconGlyph--spin-glyph`, `.ButtonIconGlyph--tab-close-glyph`,
  `.ButtonIconGlyph--table-header-menu-glyph`) rather than a class default,
  since the three compute their shared 8px size from unrelated formulas
  that only coincidentally agree today. Nothing changes visually. No
  consumer action is needed.
