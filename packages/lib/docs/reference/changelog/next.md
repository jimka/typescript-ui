# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Components

- **`Tree` and `TreeTable` no longer register `caret-down` / `caret-right`
  at module load.** Their row toggles are now a single `angle-right` glyph,
  turned to point down instead of swapped for a different one. Code that
  displays `caret-down` / `caret-right` elsewhere and relied on importing
  `Tree` or `TreeTable` to have registered them must now register them
  itself. See [Migration](/reference/migration/next) for the full note.

- **`TimeField` values sit on 1 January 1970, local.** A typed or picked
  time used to land on today's date, while a store `time` field, the time
  cell editor, the filter row and the table's paste path all use 1 January
  1970, so a `TimeField` bound to a `time` field could mark an untouched
  value dirty. A relative shorthand such as `+30mi` is still resolved
  against now; only its time of day is kept. See
  [Migration](/reference/migration/next) for the full note.

### Core

- **`DOM.sink` and `DOM.source` are now read-only.** Swap a seam through
  `DOM.install({ sink, source })` or restore the production pair with
  `DOM.reset()`; a direct assignment no longer compiles. The two calls are what
  tell the library's seam-derived caches that the handles they hold have stopped
  resolving, so an assignment that went around them left stale handles behind.
  Code already using `install` / `reset` — which is every documented path —
  needs no change. See [Migration](/reference/migration/next) for the full note.

- **`SpatialNavigation`'s region chord is now `Ctrl+Alt+Shift`+arrow.**
  The `"target"` tier's default modifiers change from `Ctrl+Shift` to
  `Ctrl+Alt+Shift`, because `Ctrl+Shift+←`/`→` is word selection in every
  text input, `MarkdownEditor` and `CodeEditor`, and the service took it
  away from all of them while enabled. The `Ctrl+Alt`+arrow control chord
  is unchanged. Restore the old chord with
  `SpatialNavigation.configure({ targetModifiers: { ctrl: true, shift: true } })`.
  See [Migration](/reference/migration/next) for the full note.

- **`DOMSink` gains one required member: `createMouseEvent(type, init)`.**
  It builds a mouse event without dispatching it, so the event's `target` is
  `null` until something dispatches it. `Tree` and `List` use it for the
  event they hand a `"contextmenu"` listener when the menu is opened from
  the keyboard. Only a consumer implementing its own `DOMSink` is affected;
  see [Migration](/reference/migration/next) for what to return.

### Data

- **`JsonWriter` writes each `Date` in its field type's form.** A `date`
  field is written as `2026-06-28`, a `time` field as `09:30:15.250`, and
  any other field as local ISO 8601 with its UTC offset
  (`2026-06-28T12:04:59.123-07:00`), no longer as `toISOString()`. The UTC
  instant did not name the day the user saw: a `date` of 28 June typed in
  Tokyo went out as `2026-06-27T15:00:00.000Z`. See
  [Migration](/reference/migration/next) for the full note.

- **`AjaxProxy`'s `filter=` writes each `Date` as local ISO 8601 with its
  offset.** A filter operand of midnight on 28 June in Los Angeles is sent
  as `2026-06-28T00:00:00.000-07:00` rather than
  `2026-06-28T07:00:00.000Z`: the same instant, plus the calendar day and
  wall-clock time the user saw. `sort=` is unchanged. See
  [Migration](/reference/migration/next) for the full note.

- **A store reads a bare date as local midnight, and a `time` field reads
  `HH:MM[:SS[.fraction]]`.** A `date` or `datetime` value of `2026-06-28`
  was read as UTC midnight, the previous day west of UTC; it is now that
  local day. A `time` value such as `09:30:15.250000` was an Invalid Date,
  so a store `time` column was always empty; it now reads as that time on
  1 January 1970, local, to the millisecond. Any other temporal text still
  goes through `new Date(raw)`. See [Migration](/reference/migration/next)
  for the full note.

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

- **A `Dialog`'s first `Escape` inside an editing surface or `Table` no
  longer closes the dialog.** A dialog whose only focusable content was a
  `CodeEditor` opened with focus in the editor, where `Tab` indented and
  `Escape` closed the whole dialog, so no key reached its buttons. The first
  `Escape` inside an editing surface now releases it: the next `Tab` or
  `Shift+Tab` moves to the dialog's next or previous control, and a second
  `Escape` closes the dialog. The first `Escape` also reaches the surface,
  so it can close an open completion list or search panel. A `Table` keeps
  the first `Escape` too, but its own `Tab` handling can still pull focus
  back into it. `Dialog.requestClose()` now returns `boolean`. See
  [Migration](/reference/migration/next) for the full note.

- **An `aria-label` you set on a `Dialog`, a `Window` or a titled `Popover`
  is now outranked by its title.** Each of the three now points
  `aria-labelledby` at the text that shows its title, and a browser prefers
  that reference over `aria-label`. A name written with
  `getAria().setLabel(…)` after construction is therefore no longer what a
  screen reader announces. Call `getAria().clearLabelledBy()` first, or pass
  `ariaLabel` in a `Dialog`'s config. See
  [Migration](/reference/migration/next) for the full note.

## Changed

### Components

- **`Tree` and `TreeTable` toggles are a thin angle that turns to point
  down, and a single expand or collapse animates.** On `Tree`, a caret
  click, row toggle, `ArrowLeft` / `ArrowRight`, `expandNode(Async)` or a
  lazy load settling with an expand waiting, and on `TreeTable`,
  `setExpanded`, a toggle click or `ArrowLeft` / `ArrowRight`, plays a
  200ms row motion after its state commits — the toggled node's children
  slide out and fade in, and the rows below move to make room — while
  bulk/structural calls, a block taller than the viewport, a commit that
  moves the scroll offset, and `prefers-reduced-motion: reduce` all snap
  instead. While a collapse plays, the rows sliding away carry
  `aria-hidden="true"`, so assistive technology reads only the committed
  rows. A call that has to scroll a row into view settles a running motion
  first, while one whose row is already in view leaves it playing; a
  keyboard move onto a child that an expand is still fading in also settles
  it. `TreeCellRenderer`'s
  `setTreeState` gains an optional fourth `animate` parameter (default
  `false`) for a caller that wants the turn animated.

- **A `Tab` strip's descriptor tools have an accessible name.** A tool built
  from a `TabToolDescriptor` showed its `label` as a tooltip only, so a
  screen reader announced an unnamed button. The label is now the button's
  accessible name as well, kept off its face. No consumer action is needed.

### Core

- **`FocusHistory` records places, not popups.** A control inside a context
  menu, dropdown, popup panel, popover, dialog or modal drawer is no longer
  a stop of the trail; a popover built with `dismissOn: "manual"`, a window
  and a non-modal drawer still are. `Alt+[` and `Alt+]` do nothing while a
  menu, dropdown, popup panel, dialog or modal drawer is open, or a popover
  that is not `dismissOn: "manual"`, and the key is not consumed. `back()`
  and `forward()` return `false` and move nothing while a dialog or modal
  drawer is open. When focus has left the current stop — it is in a table
  cell's editor, or the focused control was removed — `back()` returns to
  that stop first. Consumer action: none, unless code relied on `back()`
  reaching a dialog's own controls.

- **`FocusHistory`'s `canGoBack` / `canGoForward` and `"change"` follow
  focus.** The two flags now say what `back()` and `forward()` would do from
  where focus is. `canGoBack` is `true` when focus has left the current
  stop, also when that is the only stop, because `back()` returns to it.
  Both are `false` while a dialog or a modal drawer is open. `"change"` now
  fires when either flag changes value, and only then. It no longer fires
  after a recorded focus move or a `back()` / `forward()` call that leaves
  both flags as they were, nor from `clear()` when both were already
  `false`. It now also fires for a focus move that records nothing — into a
  table cell's editor or a popup, or off every control — and when a dialog
  or a modal drawer opens or closes. Consumer action: none for a listener
  that copies the two flags onto buttons, but read `canGoBack()` /
  `canGoForward()` once when subscribing, since no event announces the
  starting state. Code that used `"change"` to learn that a focus move was
  recorded can no longer do so.

- **`SpatialNavigation`'s control chord (`Ctrl+Alt`+arrow) chooses its
  landing by new rules.** It only considers controls that are visible —
  not ones scrolled out of another panel, clipped away, off screen, behind a
  floating window, or disabled — and it leaves focus where it is when nothing
  qualifies. A move searches the focused control's own row first (a
  `ToolBar`, `MenuBar`, `TabBar` or accordion header), then its scrolling
  panel, then everything else. Outside its row a control must be in line
  with the focused one, or at least as far forward as it is sideways. A
  `Tree`, `List` or `Table` moves level with its current row or cell. Both
  chords stay inside the non-modal window focus is in, and neither enters
  one from the page behind it. The container rule that ranked everything in
  the same collapsible or scrolling container first is gone: `Ctrl+Alt+→`
  along an accordion header's tool buttons no longer jumps to a button
  elsewhere in the same accordion. The region chord (`Ctrl+Alt+Shift`+arrow)
  keeps its ranking. No consumer action is needed.

- **`Tree` and the `Table` body show a focus ring when a spatial-navigation
  move lands on them.** Neither showed anything before.

### Overlay

- **A non-modal `Drawer` now stacks below windows, and a modal one in the
  Dialog band.** A non-modal drawer used to take the Dropdown band (10000),
  above every window and popover. It now takes the new `Band.Drawer` (8950),
  above the `Rail` and below windows. A modal drawer takes `Band.Dialog`, so
  its scrim now also covers toasts. In-page drag outlines moved from
  `Band.Window - 1` to `Band.Drawer - 1`, which keeps them under an open
  drawer as before. No consumer action is needed unless an app relied on a
  non-modal drawer covering a window.

- **A modal `Drawer` takes focus when it opens and returns it when it
  closes.** A modal drawer used to leave focus on the control that opened it,
  behind the scrim. It now moves focus to its first control once it has laid
  out, or to the drawer itself when it holds none, and keeps `Tab` and
  `Shift+Tab` inside. When the slide-out has finished, focus returns to the
  element that had it when the drawer opened, unless that element was
  disposed or removed from the page meanwhile. A non-modal drawer moves no
  focus, as before. Code that relied on the opener keeping focus while a
  modal drawer is open — a key handler on that control, say — no longer
  receives those keys until the drawer has closed.

- **A custom `DismissableLayer` should implement `onInertChanged`.** A layer
  without it stays focusable and clickable behind a modal dialog or drawer.
  One line does it: `onInertChanged(inert) { this.setInertAttribute(inert); }`.
  A surface that is not a layer, mounts itself on `<html>` and holds a
  control registers with `LayerManager.addBackgroundSurface` instead. A
  custom `LayoutManager` that mounts a component of its own on its container
  returns it from `getChromeComponents()`, which matters when it is the
  body's manager. See [Layering: Modal scope](/concepts/layering#modal-scope).

- **`Dialog`, `Window`, `TabWindow` and `Drawer` are announced as dialogs.**
  Each now has the `dialog` role, and a screen reader announces it when focus
  enters it. A `Dialog` takes its name from its title and its description
  from its `message`; `Dialog.confirm`, `Dialog.warning` and `Dialog.error`
  are alert dialogs (`alertdialog`). A `Window` takes its name from its header
  text and a `TabWindow` from its active tab's label. A `Drawer` has no title,
  so you name it with `getAria().setLabel(…)`. No layer carries `aria-modal`:
  the application behind a modal is already inert. No consumer action is
  needed unless you already name one of these yourself, which is listed
  under Breaking changes. See
  [Accessibility: Dialogs and windows](/concepts/accessibility#dialogs-and-windows).

- **Title-bar buttons have names and tooltips.** A dialog's close button and
  a window's minimize, maximize, close and window-menu buttons were unnamed
  glyph buttons. They are now named "Close", "Minimize", "Maximize" and
  "Window menu", and show the name as a hover tooltip, which is new. The
  minimize and maximize buttons read "Restore" while the window is minimized
  or maximized. The names are English; to change one, reach the button
  through `dialog.getTitleBar().getCloseButton()`, the new
  `WindowHeader.getMinimizeButton()` / `getMaximizeButton()` /
  `getCloseButton()`, or the new `TabWindow.getMinimizeButton()` /
  `getMaximizeButton()` / `getCloseButton()` / `getWindowMenuButton()`, and
  call `setText`. A button you rename keeps your name in every window state.

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


- **`VirtualScroller` exposes its content height.** `getContentHeight()`
  reads the height `setScrollY` clamps against, and `setContentHeight(h)`
  replaces it without clamping the scroll position or moving the
  scrollbars — for an owner whose content changed between renders and must
  scroll against the new height before its next one.

- **`PickerColumn` can centre a cell its caller names.**
  `scrollCellIntoView(cell)` scrolls the column so that cell sits in the
  middle of the view, as `scrollSelectedIntoView()` does for the first
  selected cell. It is for a column that shows more than one cell
  selected, as a calendar's year list does for the calendar's year and
  the year the keyboard is on. Neither method scrolls a column that is
  hidden.

- **`VirtualScroller` gains `getViewportHeight()`,** the twin of
  `getViewportWidth()`: the owner's content-box height, less the track of
  the horizontal scrollbar while that bar shows. An owner tests a row
  against it, not against its own height, to tell whether the row is in
  view.

- **A modified tab is announced to assistive technology.** While
  `Tab.setTabModified` (or `TabButton.setModified`) marks a tab, its
  button carries `aria-description="Modified"`, so a screen reader
  reports the unsaved state along with the tab's name.

- **`CodeEditor` languages accept options, and SQL can be parsed as
  PostgreSQL.** `setLanguage(id, options?)` and the new `languageOptions`
  construction option pass a settings bag to the language, and
  `getLanguageOptions()` reads it back. Options travel with the language:
  omitting them, or switching to another language, resets them to `{}`. The
  built-in `sql` language reads `SqlLanguageOptions`
  (`{ dialect?: "standard" | "postgresql" }`, default `"standard"`). The
  dialect sets the grammar used for highlighting, keyword completion and
  lint, and the engine `format()` uses. Under the default generic dialect,
  PostgreSQL's `@>` and `<@` operators and dollar-quoted strings
  (`$$ … $$`) are reported as syntax errors, and `format()` rejects them.
  With `setLanguage("sql", { dialect: "postgresql" })`, they parse and
  format cleanly. `LanguageDefinition`'s three loaders now receive the
  options; definitions that take no argument keep working. No consumer
  action is needed.

### Core

- **`LayerManager.Band` gains `Drawer`** (8950, between the `Rail`'s fixed
  8900 and `Window`).

- **`DismissableLayer` gains an optional `keepsOwnBand()`** for a nested layer
  that must stack in its own band while staying linked under its opener.

- **`Aria.setHidden(null)` removes `aria-hidden`.** Like `setExpanded(null)`,
  it leaves the element as if the attribute had never been set, where
  `setHidden(false)` writes `aria-hidden="false"`.

- **`DismissableLayer.requestClose()` may return `false` to decline.** The
  layer stays open and `LayerManager` leaves the `Escape` that triggered the
  request unhandled, so it reaches the focused content. Any other return,
  including none, counts as handled, as before.

- **`Aria` gains `setDescription` / `getDescription` / `clearDescription`**
  for `aria-description`, mirroring the `setLabel` / `getLabel` /
  `clearLabel` trio.

- **`LayerManager` gains the modal-scope API.** `hasModalLayer()` says
  whether any registered layer is modal, wherever it sits in the stack.
  `isBehindModal(node)` says whether an element lies outside the topmost
  modal layer and the layers opened from it. `containTab(e)` wraps `Tab` and
  `Shift+Tab` at the edges of that scope; the manager calls it for every
  `Tab`, and a layer that closes itself on `Tab` calls it again once focus
  is back on its opener. `addBackgroundSurface(surface)` and
  `removeBackgroundSurface(surface)` register a `BackgroundSurface`: a
  surface that is not a layer but must go inert behind a modal one.
  `DismissableLayer` gains two optional members: the `onInertChanged(inert)`
  hook, and `isLayerClosing()`, which a layer that stays registered while it
  fades out returns `true` from, so that its controls are left out of the
  `Tab` wrap meanwhile. `AnimatedDropdown` implements both. See
  [Layering: Modal scope](/concepts/layering#modal-scope).

- **`Component.setInertAttribute(value)` / `getInertAttribute()`** write and
  read the HTML `inert` attribute, buffered until render like every element
  attribute. `LayerManager` drives it for the surfaces behind a modal layer,
  and overwrites a value set from elsewhere on a layer or on a component
  added to `Body`; there is no options-bag field.

- **`Panel` gains `getScrollViewportRect()` and `revealSpan()`.**
  `getScrollViewportRect()` returns the visible window onto a scrolling
  panel's content, in browser-viewport coordinates: the panel's box inside
  its border, clear of its scrollbars, and the same rectangle under either
  `scrollbarStyle`. It returns `null` for a panel that does not scroll
  (`autoScroll: "none"`), is not rendered, or is hidden.
  `revealSpan(axis, start, end)` scrolls the least distance that brings a
  span of the content into that window along one axis; `start` and `end`
  are positions in the content, so a caller that knows its own row
  arithmetic need not measure an element. It leaves alone an axis the panel
  does not scroll, and a hidden panel.

- **`Aria` gains `setDescribedBy` / `getDescribedBy` / `clearDescribedBy`,
  `clearLabelledBy`, and the `'alertdialog'` role.** The first three read and
  write `aria-describedby`, the id of the element whose text describes this
  one. `clearLabelledBy()` removes `aria-labelledby`, which `setLabelledBy`
  could set but nothing could take away; a browser prefers that reference
  over `aria-label`, so it has to go before `setLabel` can rename an element.

- **`LayerManager.isInTransientLayer(node)`** says whether an element lies
  inside a transient layer: one that an outside click or focus move
  dismisses, such as a menu, a dropdown or a popover. Only the layer the
  element lives in is asked, not the layer it was opened from.

- **`Component` gains `navigationGroup` / `setNavigationGroup` /
  `isNavigationGroup`.** A group is one row or column of related controls
  that the control chord searches before looking elsewhere. `ToolBar`,
  `MenuBar`, `TabBar` and `AccordionHeader` are groups by default.

- **`FocusRevealer` gains an optional `getScrollViewportElement()`,** which
  a revealer that scrolls implements to name the element its content scrolls
  inside. `Panel` and `ScrollStrip` implement it.

- **`LayerManager` gains `getLayerContaining(node)` and `getLayers()`.**

### Data

- **`JsonWriter.dataFor` is `protected`.** A subclass can override it to
  change which fields are written — to drop server-generated columns, say —
  and keep `'dirty'` mode and the per-type `Date` forms, instead of
  re-implementing the `Writer` interface.

### Layouts

- **`LayoutManager.getChromeComponents()`** returns the components a manager
  mounts on its container's element beside the container's children: `Tab`'s
  tab strip, `Accordion`'s section headers and wrappers, and the gutters of
  `Split`, `Border` and `Accordion`. They are not in the container's
  `getComponents()`. `Body` reads it to make them inert behind a modal
  dialog. The base implementation returns none.

- **A `Card` can now select its visible child by a caller-supplied key.**
  `LayoutConstraints` gained a `key` field, and `Card` gained
  `setVisibleKey`, `getVisibleKey`, `hasKey` and a `visibleKey` option. A key
  names a child slot the way a component id does, with one difference that is
  the point of it: a key can name a child that has not been built yet. So
  `container.addComponent(() => new Panel(), { key: "misc" })` registers a page
  unbuilt, and the page is constructed the first time `setVisibleKey("misc")`
  asks for it — or, when the key was selected before the registration arrived,
  on the first layout pass of a rendered container. Selection by id is
  unchanged and keeps working; the two share one selection, so each setter
  retires the other. The build is synchronous, so a factory returning a promise
  throws and an asynchronous one still needs a `Tab`. `lazy: false` declines
  the deferral on a `Card` exactly as it does on a `Tab`, and `lazy` is
  therefore now read by two managers rather than one.

### Overlay

- **`DockCloseController`** types the controller a `Dock` `"beforeclose"`
  listener receives. `Dock.on("beforeclose")`, `off` and
  `DockOptions.listeners.beforeclose` used to declare a `TabCloseController`,
  although a float window's chrome ✕ passes a `WindowCloseController`. All
  three types have the same `preventDefault()` shape, so a listener annotated
  with either old type still compiles.

- **`Menu.handleKey(e)`, and the keyboard-highlight methods work in rebuild
  mode.** A control that opens a rebuild-mode menu and keeps DOM focus can
  forward its keydowns to `handleKey`: `ArrowDown` / `ArrowUp` move the
  highlight and `Enter` / `Space` activate the highlighted row. `focusItem`,
  `focusNext`, `focusPrev`, `activateFocused` and `getFocusedIndex` used to
  throw on a rebuild-mode menu; they now work in both modes. Each
  `toggleFor()` starts with no row highlighted, and so does a `show()`
  opened with the mouse. No consumer action is needed.

- **`DialogConfig.role` and `DialogConfig.ariaLabel`, and the `DialogRole`
  type.** `role` is `'dialog'` (the default) or `'alertdialog'`, for a message
  that interrupts the user and needs an answer. `ariaLabel` replaces the
  title as the dialog's accessible name. Both are config fields because
  `Dialog.show(config)` never hands out the dialog; on a constructed dialog
  the same values are reached through `dialog.getAria()`. See
  [Dialog: Screen readers](/components/Dialog#screen-readers).

- **A `Popover`'s title is its accessible name.** A popover already had the
  `dialog` role; it now points `aria-labelledby` at its title, and drops the
  reference when the title is cleared. A popover without a title has no
  name until you call `getAria().setLabel(…)`, and a popover you named
  before giving it a title keeps your name.

- **`WindowHeader` and `TabWindow` expose their title-bar buttons.**
  `WindowHeader.getMinimizeButton()`, `getMaximizeButton()` and
  `getCloseButton()`, and `TabWindow.getMinimizeButton()`,
  `getMaximizeButton()`, `getCloseButton()` and `getWindowMenuButton()`,
  return the buttons, so that an application can rename them with `setText`.

## Fixed

### Components

- **An `AutoCompleteField`'s suggestion list is no longer a Tab stop.** The
  field keeps focus while its suggestions are open and closes them on `Tab`,
  but the list itself could take that `Tab` when nothing focusable followed
  the field, and focus was then lost as the list closed. No consumer action
  is needed.

- **The table's filter row reads a typed `YYYY-MM-DD` as a local day.** A
  `date` or `datetime` operand was parsed with `new Date(text)`, which reads
  a bare date as UTC midnight, so "Equals" and the ordering operators landed
  on the previous day west of UTC. A date with a time, such as
  `2026-06-28 12:04`, is read as before.

- **A `Table` whose columns fit no longer flashes a horizontal scrollbar while
  it is resized.** A resize rescales the columns
  proportionally, and for some widths the rescaled widths summed to a fraction
  of a pixel over the width they fill. The virtual scroller and the
  `Scrollbar` both read that float error as overflow, so the horizontal bar
  showed for a frame and the viewport shrank by a track, pulling the bottom
  scroll shadow up with it. Content now has to exceed the viewport by more
  than half a pixel to count as overflow. No consumer action is needed.

- **A text field inside a `ToolBar` keeps its arrow keys.** The bar's
  roving-focus handler took `ArrowLeft` / `ArrowRight` (`ArrowUp` /
  `ArrowDown` on a vertical bar) from every child, so a `TextField`'s caret
  could not move — focus jumped to a toolbar button instead. While a
  text-entry child has focus — an `<input>` that takes text, a
  `<textarea>`, or a `contenteditable` surface such as `CodeEditor` or
  `MarkdownEditor` — the bar now leaves the arrow keys to it. `Tab` and
  `Shift+Tab` leave a text field, as before; a `CodeEditor` keeps `Tab` for
  indenting, so press `Escape` and then `Tab` to leave it. No consumer action
  is needed.

- **`SplitButton`'s dropdown opens from the keyboard.** It could only be
  opened by clicking the chevron. With the button focused, `ArrowDown` or
  `Alt+ArrowDown` now opens it with the first row highlighted; `ArrowUp` /
  `ArrowDown` move the highlight, `Enter` / `Space` run the highlighted row
  without firing the primary action, `Escape` closes it, and `Tab`,
  `ArrowLeft` and `ArrowRight` close it and move focus as usual. Focus stays
  on the button throughout. In a vertical `ToolBar` plain `ArrowDown` still
  moves between the toolbar's buttons, so `Alt+ArrowDown` opens the dropdown
  there. The button now declares `aria-haspopup="menu"`, keeps
  `aria-expanded` in step and names the menu in `aria-controls`. No consumer
  action is needed.

- **A modified tab without a glyph now shows its "unsaved changes" dot.**
  The dot was drawn only as a badge over a tab's leading glyph, so
  `Tab.setTabModified(content, true)` on a glyph-less tab showed nothing.
  On such a tab the dot now sits over the label's upper-left corner,
  still as an overlay that never moves the label. The 0.10.0 notes
  described this dot as trailing the label; since 0.10.0 it has been a
  badge on the glyph's corner.

- **Shift+F10 opens the context menu of the current tree row, list row or
  table cell.** Shift+F10 and the ContextMenu key opened nothing there: a
  `Tree`, a `List` and a table body hold focus on their own element, so the
  browser sends the key's `contextmenu` event to the widget and not to a
  row or a cell. `Tree`, `List`, `MultiSelectList`, `Table` and `TreeTable`
  now open the menu for the current row or cell and under it. Each scrolls
  that item into view first. It is the menu a right-click on that item
  opens, the selection is not changed, and with no current item nothing
  opens. One contract changes: for a keyboard menu a `Tree` or `List`
  `"contextmenu"` listener receives a synthetic event, with `clientX` /
  `clientY` under the row and a `null` `target`. No consumer action is
  needed unless a listener reads `event.target`.

- **A `List` scrolls its focused row into view.** With overlay scrollbars,
  the default, moving the focused row with the arrow keys, `Home` / `End`,
  `PageUp` / `PageDown`, type-ahead or `setFocusedIndex` did not scroll the
  list, so the row could sit out of view. `List` and `MultiSelectList` now
  scroll the least distance that shows the whole row, vertically only, so
  a list with `horizontalScrolling` keeps its horizontal position. The
  dropdown of a `ComboBox` follows its highlighted option for the same
  reason. A programmatic selection — `setSelectedIndex`, `setValue`,
  `setValues` — does not scroll, as before. No consumer action is needed.

- **A calendar's year list opens on the calendar's year and follows the
  keyboard.** The year list of a `DateField` or `DateTimeField` opened on
  its first year, with the calendar's year out of view, and the arrow
  keys, `PageUp` / `PageDown`, `Home` / `End` and typing a year moved a
  highlight the list did not follow. It now opens centred on the
  calendar's year, and each of those keys puts the year it highlights in
  the middle of the list, towards earlier and later years alike; at
  either end of the list the highlight sits as near the middle as the
  list allows. A view scrolled with the wheel or the scrollbar stays
  where it is until a key moves the highlight. A click on a month arrow
  while the list is open no longer clears the mark of the year the
  keyboard is on. A table's date and date-time cell editors open the
  same calendar and get the centring. No consumer action is needed.

- **A `Tree`, `Table` or `TreeTable` no longer leaves its current row or
  cell partly hidden.** With a border, or with the other axis's scrollbar
  showing, the row or column that the keyboard scrolled into view — or
  that Shift+F10 opened a menu for — stayed clipped by up to 16 px, under
  the border and the scrollbar. `PageUp` / `PageDown` in a `Table`,
  `TreeTable`, `List` or `MultiSelectList` also moved one row too many in
  the same situation, so one row per page was never shown whole. A page is
  now the number of whole rows in view. No consumer action is needed.

- **A `ComboBox` dropdown opens on its selected option.** It opened
  scrolled to the top, with a selected option further down out of view.
  The option is now scrolled into view by the least distance, so one below
  the first page appears at the dropdown's bottom edge. A table's combo
  cell editor opens the same dropdown. No consumer action is needed.

- **A time picker opens on its selected time.** The dropdown of a
  `TimeField` opened with every column scrolled to the top: with `09:30`
  in the field, `09` was below the view. Each column now opens with its
  selected hour, minute or second in the middle, or as near the middle as
  the ends of the column allow. A minute or second that is not a multiple
  of five has no cell, and its column is not scrolled. Picking a value
  still does not scroll. The time row of a `DateTimeField` and a table's
  time and date-time cell editors open the same dropdown. No consumer
  action is needed.

- **A `MarkdownViewer` minimap click lands on the heading after the prose
  was scrolled from the keyboard.** After `PageDown` or another scroll the
  browser makes on its own, a click on a minimap heading stopped short of
  it by the distance scrolled. No consumer action is needed.

- **A `Tree` pages with `PageUp` / `PageDown`.** The two keys did nothing in
  a tree and left the browser to scroll whatever was behind it. They now
  move the current row by one page — the number of whole rows the tree
  shows — select it and scroll it into view. With `Shift` they extend the
  selection, like the arrow keys and `Home` / `End`. `Table`, `TreeTable`,
  `List` and `MultiSelectList` already paged. One behaviour changes: a
  focused tree now takes the two keys, so they no longer scroll a panel
  around it; a `keydown` listener on an ancestor still receives them. A
  tree tall enough to show all its rows, inside such a panel, therefore
  moves to its last or first row. No consumer action is needed.

- **A `Tree`'s `Shift`+arrow starts a range when there is no anchor.** With
  nothing selected — or after the anchor's node was removed, or hidden by a
  collapse — `Shift` with an arrow key, `Home` or `End` selected one row at
  a time and never built a range. Unless a collapse had hidden the anchor,
  `getSelectedNode()` also returned `null` beside a non-empty selection.
  Such a move is now a plain move whose row becomes the anchor, as a
  `Shift`-click with no anchor already was. A `Shift`-click whose anchor a
  collapse has hidden is a plain click too: before, it selected the clicked
  row and left the hidden node as the anchor; now the clicked row becomes
  the anchor and, with `expandTrigger: "click"`, toggles. With `Ctrl` or
  `Cmd` held as well it is a `Ctrl`/`Cmd`-click, which toggles the clicked
  row in the selection where it used to replace the selection. No consumer
  action is needed.

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

- **`Favicon` no longer writes the browser-tab icon through a stale element
  handle after the DOM seams are swapped.** The injected `<link rel="icon">`
  was remembered in module state that outlived a seam swap, so a later
  `Favicon.install` swapped the `href` on a handle the new sink had never
  minted instead of appending a fresh link. The cache is now dropped
  automatically whenever the installed sink is replaced. No consumer action is
  needed.

- **`FocusTraversal` stands down entirely while an open `Dialog` is the
  topmost layer.** With focus in an editor inside the dialog, the service
  armed its own `Escape` release for the editor alongside the dialog's, and
  moved focus a second time on the next `Tab`.

- **A viewport listener registered by another viewport listener no longer
  receives the event that one is handling.** `Event.addViewportListener`
  handed the event in flight to a listener added by an earlier viewport
  listener of the same dispatch, which a native listener added during a
  dispatch never gets. A `Dialog` opened from a viewport `keydown` listener
  therefore saw the key press that opened it, and confirmed itself on
  `Enter` unless focus was on a button, a text area or an editing surface.
  Such a listener now receives the next event of its type. A viewport
  listener registered from an element listener earlier in the same event is
  unchanged. No consumer action is needed.

- **A `Panel` scrolls a control into view correctly.** After the browser
  had scrolled the panel itself — a key press such as `PageDown`, `Tab`
  moving focus to a control out of view, a touch pan, a native scrollbar —
  the reveal started from an out-of-date position and stopped short. With
  `scrollbarStyle: "native"` the control could end under the scrollbar or
  the border. A panel was scrolled along an axis its `autoScroll` mode does
  not scroll, with no scrollbar to bring it back. And a control wider or
  taller than the panel lost its start. `Panel.revealDescendant` now
  re-reads the position, measures the visible window inside the border and
  clear of the scrollbars, moves only the axes the panel scrolls, and keeps
  the start of a control that does not fit. Focus history, spatial
  navigation and a `Menu`'s highlighted row all reveal through it. No
  consumer action is needed.

- **Focus history no longer stumbles over a menu or dialog that has
  closed.** The control that opened a context menu from the keyboard, or a
  dialog, was left in the trail twice, so one `Alt+[` did nothing visible.
  Opening either dropped the forward part of the trail. `Alt+[` with a menu
  or a dropdown open moved focus to the page and left the menu or dropdown
  open. After a popup or a drawer closed with focus inside it, `Alt+[`
  skipped the control that opened it. And `enable()` with nothing focused
  recorded `<body>`, so `canGoBack` reported `true` with nowhere to go. No
  consumer action is needed.

### Layouts

- **A `Split`'s `paneSizes` and `collapsedPanes` now survive a layout pass
  that runs before its panes are added.** Both options were drained on the
  first layout pass and cleared whether or not that pass had any pane to
  apply them to, so a split handed to `Body.init` — which lays out once
  while it waits for the startup font — lost its seeded pane widths and its
  collapsed panes on every load, falling back to an equal division, or to
  each pane's own preferred width where it declares one. Each
  option is now held until the first pass that has panes. A genuinely stale
  array is still discarded whole, once, and `applyPaneSizes` now says so in
  the console instead of discarding in silence; it also warns when it is
  called before the container has panes, which is a no-op. No consumer
  action is needed.

- **A `VBox`/`HBox` child that grows past its resolved slot during its own
  commit no longer overlaps the siblings placed after it.** Both managers
  resolve every child's placement before any of them commit, so a child whose
  own `setWidth` raises its minimum height — `Markdown`'s width-triggered
  re-measure being the real-world trigger — clamped taller than the slot the
  calc phase gave it, while every later sibling kept the position that phase
  had already fixed. The overlap cleared itself one frame later, once the
  growing child's own scheduled layout caught up, but that frame was
  visible: a demo block on the docs site landed up to 1909px inside the
  prose above it. Committing a placement loop now carries a running
  main-axis drift — how far each child committed *past* the extent resolved
  for it — onto every later sibling, in the same pass. Only growth is
  carried, so a child that commits smaller than its resolved extent, as an
  equal-mode cell's child with a size ceiling of its own does on every pass,
  leaves its siblings exactly where they were planned. No consumer action is
  needed.

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

- **`DOM.reset()` now cancels a `Notification`'s pending auto-dismiss, and
  disposing a toast cancels its own.** The toast's auto-dismiss timer used
  the bare global `setTimeout`, which `DOM.reset()` cannot reach, so a suite
  that showed a toast and then reset the DOM had the dismiss run afterwards
  and animate the toast out through handles the reset had discarded. The
  timer now goes through `DOM.sink`, like `AutoCompleteField`'s and the
  table filter row's, and `Notification`'s destructor clears a timer a
  dispose would otherwise have left armed. No consumer action is needed.

- **The keyboard can no longer reach the application behind a modal `Dialog`
  or `Drawer`.** A dialog wrapped `Tab` only while it was the topmost layer
  and only between the first and last element its selector matched, so focus
  got out in several ways: `Tab` from a context menu or an open `ComboBox`
  dropdown on the dialog's last control; `Shift+Tab` after a click on the
  dialog's text; `Tab` from the last visible control when a hidden one
  followed it; and `Alt+[` with a menu open, which
  [`FocusHistory`](/recipes/focus-history) took to a control of the page. A
  dialog with nothing focusable left focus on the button that opened it,
  where `Space` opened a second one. A modal drawer did not hold focus at
  all. Now, while a modal dialog or drawer is open, the rest of the
  application is `inert` — every component added to `Body`, every layer the
  modal was not opened from, the `Rail`, and each toast's dismiss button —
  so it cannot be focused, clicked or read by a screen reader. `Tab` wraps
  inside the modal and the layers opened from it, and a modal with nothing
  focusable takes focus itself. The library marks its own containers and
  never `<body>` or `<html>`, so a browser extension's own menu beside a
  dialog stays usable. Three things follow for application code.
  `element.focus()` on something behind a modal does nothing until the modal
  closes. An element appended by hand to `<body>` or `<html>` is not made
  inert and can still be reached; build it as a `Popover` or `PopupPanel`,
  which take part. And the feature needs the `inert` attribute: Chrome 102,
  Firefox 112, Safari 15.5 (see
  [Browser support](/reference/browser-support)). See
  [Dialog: Keyboard](/components/Dialog#keyboard) and
  [Layering: Modal scope](/concepts/layering#modal-scope).

- **A `Window` disposed while shown leaves the layer tree.** `dispose()` on
  an open window, or on a `TabWindow`, tore the window down but left it
  registered with `LayerManager`, so `getTopLayer()` could go on naming a
  window whose element was gone and the manager's document listeners were
  never removed. Its destructor now unregisters it, as every other layer's
  does. A window closed first is unaffected. No consumer action is needed.

- **A modal `Dialog` is no longer drawn beneath — and left clickable under —
  another overlay.** A dialog opened while any layer was open inherited that
  layer's band. Opened from a window, it sat below pinned windows, popovers
  and toasts, with its backdrop tied with the window. Opened with a drawer
  open, its backdrop sat under or tied with the drawer, which then took clicks
  and focus. A dialog now always stacks in the Dialog band. No consumer action
  is needed.

- **A `Dialog` whose opener is disposed while it is open now closes cleanly
  and resolves `show()`.** On close, a dialog returns focus to the element
  that had it when the dialog opened. If that element had been disposed in
  the meantime — a button in a tab the dialog's own action closed, say — the
  restore threw `DOM handle <n> is not registered`, and the promise `show()`
  returned never resolved, so code after the `await`, a `finally` included,
  never ran. The dialog now skips the restore when that element is gone or
  no longer on the page, leaving focus on the page, and resolves `show()`
  even if restoring focus fails. No consumer action is needed.

- **`Dock` no longer emits `focus(null)` while a panel is still open.** When
  the focused panel closed and its region was left empty — the last tiled tab
  closing while a float stayed open, or a focused float closed with its
  chrome ✕ — the Dock reported that nothing was focused. A click into an
  already-active float did not correct it. Focus now moves to the active
  panel of the same float, then of the tiled tree, then of the frontmost
  float. `focus(null)` fires only once no panel remains anywhere. No consumer
  action is needed.

- **Rebuild-mode `Menu`s declare `role="menu"`.** Context menus, the
  `MenuButton` and `SplitButton` dropdowns and the `ToolBar` overflow menu
  rendered `menuitem` rows inside an element with no role. They now carry
  `role="menu"`, as persistent-mode menus already did. No consumer action is
  needed.

- **A context menu opened from the keyboard can be worked from the
  keyboard.** Shift+F10 or the ContextMenu key opened the menu, but the arrow
  keys, `Enter` and `Space` went on acting on the control that had focus: the
  caret moved, a line break was inserted, and no row could be reached. A
  `Menu.show()` that follows a key press now takes focus, highlights its
  first enabled row, and handles `ArrowDown` / `ArrowUp`, `Home` / `End`,
  `Enter` / `Space`, `ArrowRight` / `ArrowLeft` for submenus, `Tab` and
  `Escape`. When it closes, focus returns to where it was, before a closing
  row's `action` runs. A menu opened with the mouse, and the `SplitButton`
  and `MenuBar` dropdowns, behave as before. A table cell editor keeps its
  edit open while such a menu is up, and a date or time editor its picker.
  The menu names its highlighted row in `aria-activedescendant`, through the
  new `MenuRow.getActiveDescendantId()`. A modifier pressed by itself and a
  held key's auto-repeat do not count as a key press. See
  [Menu: Keyboard](/components/Menu#keyboard). No consumer action is needed,
  with two exceptions. Code that calls `show()` for a dropdown whose trigger
  should keep focus after a key press should call `toggleFor()` instead. A
  custom `CellEditor` that overrides `retainsFocus` should also return `true`
  when `super.retainsFocus(...)` does, or its edit ends when the menu opens.

- **An `initialFocus` component that is hidden or disabled no longer leaves a
  dialog without focus.** The dialog called `focus()` on it, the browser
  refused, and focus rested on `<body>` until the first `Tab`. A screen
  reader announces a dialog when focus enters it, so such a dialog was not
  announced at all. `initialFocus` now resolves to the component's first
  visible, enabled stop, and a component that offers none falls back to the
  default order. No consumer action is needed.

- **A window constructed minimized or maximized shows the restore glyph.** A
  `Window` built with `windowState: "minimized"` or `"maximized"` kept the
  minimize and maximize glyphs of the normal state on its header buttons,
  because the glyph was swapped only on a transition. The header now reflects
  the state the window starts in, and so do the button names: "Restore" on
  the matching button of a `Window` or a `TabWindow`. No consumer action is
  needed.
