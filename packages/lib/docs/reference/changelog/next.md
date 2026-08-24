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
