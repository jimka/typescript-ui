# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Overlay

- **A restore that interrupts a rail minimize now announces `['minimize',
  'restore']` rather than `"restore"` alone.** The `"minimize"` a rail-bound
  window owes is deferred to the end of the 150 ms shrink-into-the-rail
  animation, and a restore arriving inside that shrink used to void it — so
  the pair arrived unbalanced, with a `"restore"` no `"minimize"` preceded.
  The debt is now paid on that route too, matching what `setRail` already did
  for a window that stays minimized under a new owner, and matching the two
  events' documented meaning: the window's state reads `"minimized"` for the
  whole shrink, so the old behaviour left that transition unannounced. A
  consumer that counts the two events now sees them balance. See
  [Migration](/reference/migration/next) for the full note.

## Added

### Components

- **A column resize now reports when it ends.** `TableHeaderEvent` gained
  `"columnresizeend"` and `HeaderCellEvent` gained `"resizeend"`, the header
  cell event the header relays to produce it. Both shipped in 0.10.0 and were
  left out of that release's notes, so they are recorded here rather than
  under a version they did not belong to. A consumer that persists a column
  width, or that runs work which should wait for the drag to settle, listens
  for the end event instead of debouncing `"columnresize"`. The existing
  `"columnresizestart"` and `"columnresize"` are unchanged.

## Fixed

### Core

- **A completing animation no longer clears a `transition` a later animation
  on the same element is running through.** `transition` is one CSS property
  on one element, so two animations playing on the same element share the
  declaration — and because the one that started first also finishes first,
  its completion was taking the rule out from under the one that had
  superseded it. The superseded animation's deadline landed mid-flight and
  the live animation snapped to its end state instead of travelling to it,
  losing as much as its whole duration minus the 40 ms fallback grace: a
  second gesture 108 ms into a 120 ms fade cost that fade 68 of its 120 ms.
  A completion now leaves the declaration alone while a later animation on
  the same element is still running through it, and that later one clears it
  at its own end. The surfaces a plain gesture reaches are `ComboBox` and
  the other picker dropdowns, `PopupButton` panels, `Menu`, `Popover`,
  `Dialog` (panel and backdrop), `Drawer` (panel and scrim), and `Window` —
  whose own element carries four of these animations at once, its entrance
  fade, its close fade and the two rail genies, and whose rail pair is the
  instance `rail-handover-follow-ups` had fixed per-site. No consumer action
  is needed.

### Overlay

- **A window closed while its rail-minimize genie is still running now fades
  out from its resting state.** Closing a window mid-collapse cancelled the
  genie, but a cancel writes no styles, so the shrink-into-the-rail
  `transform` and `opacity` were still on the element and the close fade
  animated out of the shrunken, half-faded state — reading as the window
  simply disappearing. The collapse is now undone and the window's resting
  state committed two animation frames before the fade arms, so the close
  fade of a window caught mid-collapse starts that much later than an
  ordinary one, which is unchanged. No consumer action is needed.
