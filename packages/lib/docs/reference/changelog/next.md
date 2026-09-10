# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Added

### Components

- **`TabBar` gains `setEntryModified(id, modified)` / `isEntryModified(id)`**,
  and **`TabButton` gains `setModified(modified)` / `isModified()`** as the
  button-level mechanism they run through — a small filled dot trailing a
  tab's label, marking unsaved changes, that survives label truncation since
  it is a real content-row child rather than baked into the label text.

### Layouts

- **`Tab.setTabModified(content, modified)` / `isTabModified(content)`** show
  or hide a live tab's "unsaved changes" dot. Like `setTabItalic`, the flag
  is view-only — it is not written to the tab's `LayoutConstraints`, so it
  does not survive a tear-off, a re-dock, or a saved layout.
