# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Core

`DOMSink` gains one required member: `clearDocumentSelection()`. Only a
consumer implementing its own `DOMSink` is affected.

## Changed

### Table

**Horizontal scrolling to either end of a wide table is no longer slower
than scrolling through its middle.** The rendered column window keeps a
constant width at every scroll offset, so reaching the first or last
columns no longer forces every visible row to re-derive its whole cell
set. A few more columns are rendered when the table is scrolled hard
against either end — the same number it renders mid-scroll. No consumer
action is needed.

## Fixed

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

### Components

- **A `ToggleButton` that is both selected and pressed now resolves its
  `.pressed` chrome, not `.selected`.** The two states were not previously
  ordered relative to each other for a control that could be in both at
  once (an unusual but reachable combination — press-and-hold on an
  already-selected toggle); `.pressed` now wins wherever the two declare
  the same property. No consumer action is needed.
