# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Fixed

### Core

- A component disposed synchronously by a handler running during an event's
  own dispatch — most commonly, a tab's close button disposing the tab's
  content — no longer throws `DOM handle <n> is not registered` when that
  same event's subtree-listener walk reaches the released handle. The walk
  now ends cleanly at that point instead.
