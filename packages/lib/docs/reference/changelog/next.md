# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Changed

### Core

- **`FocusHistory.back()` / `forward()` now reveal a hidden trail entry before
  focusing it**, rather than silently failing to move focus onto an element
  the browser cannot currently see. Reveal selects the `Tab` a target lives
  in, expands a collapsed `Border` region / `Accordion` section / `Split`
  pane, and scrolls an `autoScroll` `Panel` — in each case only if needed. A
  trail entry that still cannot be brought into a focusable state after
  revealing is skipped rather than failing the whole navigation. Public
  signatures are unchanged; existing consumers see focus land where it
  previously could not.

## Added

### Components

- **`TabBar` gains `setEntryModified(id, modified)` / `isEntryModified(id)`**,
  and **`TabButton` gains `setModified(modified)` / `isModified()`** as the
  button-level mechanism they run through — a small filled dot trailing a
  tab's label, marking unsaved changes, that survives label truncation since
  it is a real content-row child rather than baked into the label text.

- **`CodeEditor` gains `revealRange(at, options?)`**, for jumping the editor to
  a range a host computed elsewhere — a search hit, a diagnostic, a stack
  frame. It selects the 1-based `{ line, column, length }` range, scrolls it
  into view, and paints an accent highlight over it that survives the editor
  not having focus, which a native selection does not. `options.focus: false`
  previews a location without stealing focus; `options.highlight: false`
  suppresses the highlight; `options.scrollAlign` (`"nearest"` by default, or
  `"center"`/`"start"`/`"end"`) chooses where the range lands in the viewport
  once scrolled into view, on both axes — `"center"` keeps surrounding
  context visible on every side, useful when the reveal comes from a results
  list rather than in-place navigation. The target is clamped against the
  live document, so a stale position lands at the nearest valid range
  instead of throwing. The
  new types `CodeEditorRevealTarget` and `CodeEditorRevealOptions` are exported
  from `component/editor`. No consumer action is needed.

### Layouts

- **`Tab.setTabModified(content, modified)` / `isTabModified(content)`** show
  or hide a live tab's "unsaved changes" dot. Like `setTabItalic`, the flag
  is view-only — it is not written to the tab's `LayoutConstraints`, so it
  does not survive a tear-off, a re-dock, or a saved layout.

### Core

- **New `FocusReveal` broker**, exported from `core` alongside
  `FocusHistory`. Hiding containers (`Tab`, `Border`, `Accordion`, `Split`,
  and the scroll `Panel`) register as `FocusRevealer`s; `FocusReveal.reveal(target)`
  invokes every registered revealer containing `target`, outermost-first, so
  a hidden descendant can be brought into a focusable state before something
  focuses it — the mechanism `FocusHistory.back()` / `forward()` now use (see
  Changed, below). Most consumers won't call this directly.

## Fixed

### Components

- **Expanding or collapsing a `Tree` node no longer rebuilds every visible
  row's toggle caret, nor repositions every visible row, when most of what's
  on screen hasn't actually changed.** Internally, `TreeRow.setRowData` tore
  down and reconstructed the expand/collapse caret `Glyph` on every bind of
  a row with children, even when the row's `hasChildren`/`expanded`/
  `loading` triple was unchanged, and `Tree`'s reflatten path unconditionally
  marked every pooled row unbound before every expand/collapse/lazy-load
  transition. A row is now rebound only when what it was last bound to has
  actually changed, so collapsing or re-expanding a folder costs work
  proportional to the rows that actually changed rather than to how many
  other expandable rows happen to be visible. `setNodes` and
  `setRendererFactory` still force a full rebind of every visible row, since
  either can hand a row genuinely different content behind an unchanged
  node/state — a caller mutating a node's fields in place before calling
  `setNodes` again, or a fresh renderer with no cached content to compare
  against. No consumer action is needed.

- **Expanding or collapsing a `Tree` node deep in a scrolled, densely
  expanded tree no longer rebinds most of the visible rows.** A pool slot was
  assigned by flat position, so inserting or removing a run of rows shifted
  every row below the change point into a different slot than the one
  already correctly showing it, forcing a rebind and — for an expandable row
  — a toggle-caret rebuild, even though the row's own content never changed.
  A render pass now re-matches each pool slot to the node it was already
  showing, by identity, before deciding which slots to rebind, so a node
  that stays on screen keeps its slot, its DOM element, and its caret across
  an unrelated toggle and pays only a reposition. No consumer action is
  needed.
