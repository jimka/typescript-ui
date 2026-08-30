# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Changed

### Menu

- **`CheckboxMenuRow` and `RadioMenuRow` now share a new `AbstractBooleanMenuRow`
  base.** `action` moves onto the framework's `on` / `off` listener surface;
  the call shapes are unchanged. The unused `CheckboxMenuRowEvent` and
  `RadioMenuRowEvent` type exports are removed in favour of
  `AbstractBooleanMenuRowEvent`. No consumer action is needed.

## Fixed

- `TreeRow`, `FieldSet`, `ComboBox`'s collapsed-control label, and the
  `Label` / `IconLabel` / `Glyph` item renderers used by `Tree` and
  `List` / `MultiSelectList` each raw-append a child (a toggle glyph, a
  loading spinner, an icon, a legend, a label, a row's content renderer)
  instead of registering it via `addComponent`, so `dispose()` never reached
  it — a `Tree` row's toggle glyph, for example, leaked on every
  expand/collapse rather than only at teardown. Every such child is now
  disposed when it is discarded (a rebind, a renderer swap) or, failing
  that, on the owning component's own teardown.
- `List` / `MultiSelectList`'s row pool leaked every row (and everything it
  owned) when shrunk by `setItems`, since `AbstractSelectableList.syncRows`
  only detached the surplus rows via `removeComponent` rather than disposing
  them. The cached empty-state placeholder had the same gap when replaced or
  torn down while detached.
- `Tree.setRendererFactory`, `AbstractSelectableList.setRendererFactory`,
  and `ComboBox.setRendererFactory` now dispose the renderer they replace on
  each row, instead of leaving the caller with no reference to release it.

### Core

- **`setId` on an already-rendered component now deletes the `#<old-id>`
  rule it replaces instead of leaving it on the shared stylesheet.** A
  `setId` call after first render swapped in a fresh per-instance
  `StyleRule` for the new selector but never disposed the one it replaced,
  leaving a dead rule behind for the life of the page. No consumer action
  is needed.
- **Re-registering an already-registered listener reference through
  `Event.addListener` / `addSubtreeListener` now applies the new call's
  `button` / `stop` / `prevent` options instead of silently keeping the
  first registration's.** No consumer action is needed.
- **`Event.addViewportListener` now ignores a repeat registration of the
  same function reference instead of registering it a second time and
  firing it twice.** No consumer action is needed.

### Menu

- **Activating a `CheckboxMenuRow` or `RadioMenuRow` with Enter now fires its
  `action` listener.** Previously only a mouse click did, so a keyboard user
  could flip the control without the application ever hearing about it. No
  consumer action is needed.
- **A `MenuBar` dropdown's `separator: true` entry now renders through
  `MenuSeparator`,** the same class a context menu already used. No consumer
  action is needed.
