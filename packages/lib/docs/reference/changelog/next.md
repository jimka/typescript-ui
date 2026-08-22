# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Core

`DOMSink` gains one required member: `clearDocumentSelection()`. Only a
consumer implementing its own `DOMSink` is affected.

## Fixed

### Table

Selecting text inside a single cell works again, and Ctrl/Cmd+C copies that
text; the cell-range drag now takes over only once the drag crosses into
another cell.
