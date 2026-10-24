# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Changed

### Components

- **`Tree` and `TreeTable` animate the toggles that used to snap.** A node
  whose children are taller than the viewport now animates the children
  that are on screen while it is open, and a collapse near the end of a
  scrolled list slides the rows above down as the children close, instead
  of jumping. One toggle still snaps: a node scrolled out of view above
  the viewport whose open children reach more than a viewport below it. A
  scroll made while one of these motions plays settles it at once.
