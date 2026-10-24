# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Layouts

- **A tab change made from code no longer takes keyboard focus.** Selecting a
  tab from code (`Tab.setActiveTabIndex`, `Tab.setActiveContent`,
  `Dock.focusPanel`, `Dock.addPanel`) moves only the tab stop unless the strip
  already holds focus, nothing does, or focus is inside the content the switch
  hides. Closing the active tab from code (`Tab.closeTab`, `Dock.removePanel`)
  moves focus to the neighbouring tab only when the closed tab or its content
  held it. `TabBar`, which has no content to check, applies the strip part of
  the rule: `TabBar.setActiveEntry` moves focus only when the strip holds focus
  or nothing does, and `TabBar.removeBarEntry` moves it to the neighbour only
  when the removed cell held it. See
  [Migration](/reference/migration/next#a-tab-change-made-from-code-no-longer-takes-keyboard-focus).
- **A close made on the strip ends with focus on the active tab.** After the
  ✕, `Delete`, the context menu's *Close* or one of its bulk closes, keyboard
  focus and the tab stop are on the strip's active tab, wherever focus was:
  the tab that becomes active when the active tab closed, the tab that stays
  active otherwise, and also when a `"beforetabclose"` listener keeps one of a
  bulk close's tabs open. Before, closing a background tab moved focus to its
  neighbour only when that tab held it, which could leave focus on a tab that
  was not selected. See
  [Migration](/reference/migration/next#a-tab-change-made-from-code-no-longer-takes-keyboard-focus).

## Changed

### Components

- **`Tree` and `TreeTable` animate the toggles that used to snap.** A node
  whose children are taller than the viewport now animates the children
  that are on screen while it is open, and a collapse near the end of a
  scrolled list slides the rows above down as the children close, instead
  of jumping. One toggle still snaps: a node scrolled out of view above
  the viewport whose open children reach more than a viewport below it. A
  scroll made while one of these motions plays settles it at once.

### Layouts

- **A float rebuilt by `restoreLayout` ends with `autoFocus` on.** The
  restore's own show still takes no focus. Later raises now match a float torn
  off a tab strip, so `Dock.focusPanel(id)` and a drop into the float move
  focus into it again; this reverses the last sentence of the 0.11.0 entry.
  Pass `{ focus: false }` to `focusPanel` to keep focus where it is.

## Added

### Components

- **`CodeEditor.openSearch()` opens the search card from code.** It does
  what `Ctrl-F` (`Cmd-F` on macOS) does in the document: it opens the
  floating search card, seeds the find field from the selection and moves
  focus to it, re-focusing the field when the card is already open. It is
  for a Find… menu item, a command-palette entry or an app-wide shortcut
  that targets an editor while focus is elsewhere. Before the editor has
  mounted its view it does nothing and returns `false`. See
  [Search and replace](/components/CodeEditor#search-and-replace).

### Layouts

- **`Tab.setActiveTabIndex` and `Tab.setActiveContent` take `{ focus }`** to
  override the strip's focus rule per call: `true` always moves focus onto the
  new tab, `false` never does. `TabBar.setActiveEntry`,
  `TabBar.removeBarEntry`, `RovingTabIndex.moveTo` and `RovingTabIndex.remove`
  take the same option. See [Selecting a tab](/layouts/Tab#selecting-a-tab).
- **`TabBar.focusActiveEntry()`** moves the tab stop onto the active cell and
  focuses it without emitting `"tabpressed"`, and a scrollable strip brings
  it into view on its next layout, for an owner that ends a close on the
  active tab. See [Cell lifecycle](/components/TabBar#cell-lifecycle).

### Overlay

- **`Dock.focusPanel(id, { focus: false })` activates a panel and raises its
  float without moving keyboard focus,** for selection driven from a tree or
  list. See [Programmatic control](/components/Dock#programmatic-control).
- **`bringToFront({ focus })`** on `Window` / `TabWindow`: `false` raises
  without focus, `true` takes focus also with `autoFocus: false`, omitted
  follows `autoFocus`. See [Focus](/components/Window#focus).

## Fixed

### Layouts

- **The spring-loaded raise during a tab drag no longer moves keyboard focus**
  into the window it raises (`DockRegion`, and a `Tab` strip in a window).
  Since 0.11.0 it did, which left focus in a window the drag only passed over.
- **A tab dropped onto another strip keeps keyboard focus.** When the
  dragged tab was its source strip's active tab, focus used to move to the
  tab left behind in the source strip once the drop finished; it now stays on
  the dropped tab, where the drop put it.
- **`FocusReveal` opening a hidden tab no longer focuses the tab button**
  before it focuses its target.
