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
- **A `List` or `MultiSelectList` empty-state placeholder is painted in
  the theme's new muted text colour.** It borrowed the disabled-row colour,
  `list.row.disabledColor`, which reads 2.32 : 1 against the light themes'
  list background and 2.49 : 1 against the dark one. It now uses
  `text.mutedColor` (see *Added*), at 5.92 : 1 in `ModernTheme`, 8.86 : 1
  in `ClassicTheme` and 7.11 : 1 in `DarkTheme`. A theme that
  recoloured the placeholder through `list.row.disabledColor` now does so
  through `text.mutedColor`; disabled rows still use
  `list.row.disabledColor`. A theme that sets no `text.mutedColor` paints
  the placeholder in its `text.color`.

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
- **`Tree` gains `moveNode(node, parent, index)`**, which moves a node and
  everything under it to a new position or a new parent without it leaving
  the tree. The node and every node under it keep their expansion,
  selection, loaded children and any lazy load in flight, and the focus and
  anchor stay put, so a file explorer can rename or move a folder without
  collapsing it. `index` is where the node ends up, clamped as in
  `insertNode`. A move to the node's current position does nothing, and a
  move into the node's own subtree, or of or under a node the tree does not
  hold, is ignored. Like the other node-level methods it emits no event and
  never animates, and it keeps the scroll offset unless the move leaves
  the content too short for it. A rename that changes the
  sort order is `moveNode` followed by `notifyNodeChanged`. See
  [Moving and renaming a node](/components/Tree#moving-and-renaming-a-node).

### Core

- **`Theme.text.mutedColor`, written to `:root` as
  `--ts-ui-text-muted-color`** — a theme-wide colour for de-emphasised
  text that must stay readable, such as a path beside a name, a hint, a
  count or an inactive label. It is `rgb(100, 100, 100)` in `ModernTheme`,
  `rgb(74, 74, 74)` in `ClassicTheme` and `rgb(180, 180, 180)` in
  `DarkTheme`, and each meets WCAG AA's 4.5 : 1 on the page, inputs,
  lists, menus, popovers, bars, tabs, headers and tooltips of its theme,
  gradients included, though not on fills such as buttons, badges or
  notifications. It is optional: a theme
  made with `defineTheme` from a built-in theme inherits it, and a theme
  that leaves it out writes its `text.color` to the variable. See
  [Theming](/concepts/theming#theme-keys).
- **`ThemeManager.onThemeChange(listener, { persistent: true })`.** A
  theme-change listener now belongs to the DOM environment it subscribed
  in: replacing the DOM seam (`DOM.install` with a new sink, or
  `DOM.reset`, which only test setup does) drops it, so a component left
  undisposed by a test no longer stays reachable through the listener list.
  Pass `persistent: true` for a subscriber that must outlive every
  environment, such as a module-level cache. The cleanup function returned
  now removes only its own subscription: a function subscribed twice stays
  subscribed once after one cleanup, where both used to be removed. See
  [Theming](/concepts/theming#theme-change-listeners).

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
- **`Tab.removeMovedTab(content)`** removes the tab of content that code has
  already moved to another container, without destroying it or firing
  `tabclose`. See [Tear-off & re-dock](/layouts/Tab#tear-off-re-dock).
- **`serializeLayout` and `restoreLayout` take `{ includeWindow }`**, a
  predicate that limits the windows they capture, park and close to the ones
  it accepts. Without it both cover every open window except a host of the
  layout, as before. See
  [Limiting the windows](/layouts/LayoutSerialization#limiting-the-windows).
- **`LayoutSerializationOptions.isPanel`** marks a component whose own layout
  is a `Split` or `Tab` as one panel: `serializeLayout` records it as one
  `panel` node, and `restoreLayout` parks and re-homes it whole instead of
  descending into it. See
  [Panels that use a Split or Tab layout](/layouts/LayoutSerialization#panels-that-use-a-split-or-tab-layout).

### Overlay

- **`Dock.focusPanel(id, { focus: false })` activates a panel and raises its
  float without moving keyboard focus,** for selection driven from a tree or
  list. See [Programmatic control](/components/Dock#programmatic-control).
- **`bringToFront({ focus })`** on `Window` / `TabWindow`: `false` raises
  without focus, `true` takes focus also with `autoFocus: false`, omitted
  follows `autoFocus`. See [Focus](/components/Window#focus).
- **`Dock.splitPanel(targetId, panel, side, options?)`** puts a panel in a new
  pane beside another panel from code — the split a tab dropped on a region
  edge makes — for commands such as *Split Editor Right*. `panel` is a
  registered id to move or reopen, or a spec to open; `ratio` sets the new
  pane's share of the target group's slot.
  See
  [Programmatic control](/components/Dock#programmatic-control).
- **`Dock` emits `splitresize`** when the user resizes a split from its
  gutter — once when a drag ends — and each time one of its panes collapses
  or expands, in the main dock or a float. Its
  [`DockSplitEvent`](/api/overlay/interfaces/DockSplitEvent) payload carries
  the host window, the pane ratios and collapsed flags, and the panel ids in
  each pane, so an application can save its layout without polling
  `getLayoutState()`. Window resizes and changes to the region tree do not
  fire it. See [Dock: `splitresize`](/components/Dock#splitresize).

## Fixed

### Components

- **A `Markdown` (and so `MarkdownViewer`) shows its whole document the
  first time it is shown.** Its first measure read the content height
  before the prose column's max-measure reached the stylesheet, so it
  measured at the full pane width, came out too short, and cut the
  document off — most visibly for a viewer built lazily as a keyed `Card`
  page. Nothing measured again until the next `setMarkdown`, width or theme
  change.
- **A `Table` column's declared or sampled width survives the next layout
  pass.** When the widths did not fit the table, the pass after the first —
  which a browser always runs — rescaled `string` and `auto` columns
  toward the available width with nothing resized, so `width` and
  `autoSizeColumns` widths were squeezed instead of the table scrolling
  horizontally. Columns now rescale only when the table's width changes;
  space a hidden column frees still goes to the unbounded flexible
  columns.

### Layouts

- **`serializeLayout` (and so `Dock.getLayoutState`) no longer records the
  window that hosts the layout as a float.** For a `Dock` placed in a
  `Window`, the state carried that window as a float whose content was the
  dock itself, so a restore warned `no component for panelId`, or, when the
  host's content was a split or tab group, opened a second copy of the window
  and moved panels into it. `restoreLayout` already left the host window
  alone; saving now matches it.
- **The spring-loaded raise during a tab drag no longer moves keyboard focus**
  into the window it raises (`DockRegion`, and a `Tab` strip in a window).
  Since 0.11.0 it did, which left focus in a window the drag only passed over.
- **A tab dropped onto another strip keeps keyboard focus.** When the
  dragged tab was its source strip's active tab, focus used to move to the
  tab left behind in the source strip once the drop finished; it now stays on
  the dropped tab, where the drop put it.
- **`FocusReveal` opening a hidden tab no longer focuses the tab button**
  before it focuses its target.
- **`restoreLayout` (and so `Dock.setLayoutState`) restores the saved ratios
  of nested splits.** `Split.applyPaneRatios` on a split that had not been
  laid out yet seeded the ratios against a unit base, and the split's first
  layout raised each pane to its minimum size before scaling them, so they
  came out in proportion to the minimums: a `Dock`'s stacked tab groups
  restored at equal heights, and a pane beside one with a large minimum
  could shrink to under a pixel. The ratios are now held until the split
  first has a size. A later `applyPaneRatios` also replaces a `paneSizes`
  option that has not been applied yet.
- **`serializeLayout` records every tab of a `TabWindow`, and `restoreLayout`
  rebuilds it as one.** A tab-strip window was saved with its first tab only,
  as a plain window, and a restore left its other tabs inside the closed
  window. It is now saved as a `WindowNode` with `windowMode: "strip"` and a
  `tab` node of every tab, and restores as a `TabWindow` with the same active
  tab. A state saved before this release has no `windowMode` and holds only
  the first tab: it restores as a `Window` holding that tab, and the other
  tabs cannot be recovered from it, so save the layout again. See
  [Tab-strip windows](/layouts/LayoutSerialization#tab-strip-windows).
- **A split or tab group rebuilt by `restoreLayout` (and so
  `Dock.setLayoutState`) fills its slot.** The rebuilt group was a plain
  `Component`, which grows to its content's minimum size, so a `Dock` panel
  taller than the dock overflowed it after a restore instead of scrolling
  inside it. It is now a `Container`, as the `Dock` builds it.

### Overlay

- **A lazy `Dock` panel that is closed while loading and added again stays
  open when the first load fails.** With `disposeOnClose: false`, the closed
  panel's frame is kept, and its content factory goes on running. When that
  factory rejected after the panel had been re-added, the dock closed the
  re-added panel and emitted `close` and `exception` for it. Only the load
  of the panel that is open now reports to the dock. No consumer action is
  needed.
- **Disposing a `Dock` while one of its floats stays open lets go of the
  dock.** The float window, the tab groups and splits in it and its lazy
  panels' frames kept the listeners the dock had given them, so the float
  held the disposed dock for as long as it stayed open, and a lazy panel's
  factory settling after the dispose called into the destroyed dock. The
  dock now removes every listener it gave them when it is disposed. No
  consumer action is needed.
- **`Dock.getLayoutState` and `Dock.setLayoutState` cover only the dock's own
  floats.** A save recorded every open window — application windows and
  another dock's floats among them — and a restore closed all of them but the
  window the dock sits in, warning `restoreLayout: no component for panelId`
  for each panel it could not rebuild in them. Both now cover only the floats
  holding one of the dock's panels, and a restore leaves every other window
  open. A saved window that names none of the dock's registered panels, which
  a state saved before this release can contain, is skipped without a
  warning. No consumer action is needed. See
  [Saving and restoring](/components/Dock#saving-and-restoring).
- **`Dock.setLayoutState` keeps every panel of a tab-strip tear-off, and
  every lazy panel.** A tear-off holding several tabs came back as a header
  window with its first tab only; the dock emitted `close` for the others and
  lost them. A panel added with `addLazyPanel` was destroyed by a restore,
  which warned `restoreLayout: no component for panelId` for two unknown ids.
  Both now come back where they were saved. A state saved before this release
  still lacks those panels and cannot bring them back; save the layout again
  to record them. Restoring such a state while a tab-strip window holds
  several tabs no longer closes the tabs it does not name: they stay
  registered but are not placed, and the dock emits `detach` and then
  `attach` with `window: null` for each, as it already did for the panel of
  a header window the state does not name. See
  [Saving and restoring](/components/Dock#saving-and-restoring).
