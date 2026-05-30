# Migrate Listener Deprecations — Implementation Plan

## Overview

`plans/implemented/listener-shape-consistency.md` shipped the canonical
`on` / `off` / `emit` surface on every emitting class in the framework, and
left a layer of `@deprecated` one-line forwarders behind so existing callers
keep working unchanged. This plan deletes that forwarder layer: it migrates
every remaining `.addXxxListener(...)` / `.setOnXxx(...)` call site (both in
the demo panels and inside the lib) to the canonical `.on('xxx', ...)`
form, and then removes the deprecated methods, the per-class
`fireXxxListeners` private helpers (where still present), and the legacy
`onXxx` single-callback fields on `XOptions` interfaces.

The scope is mechanical — no architectural decisions, no new abstractions —
but it spans every demo panel and a handful of lib classes that today still
self-forward through the deprecated surfaces. Splitting it into a separate
plan keeps the original consistency plan's diff focused on the shape change
and lets this cleanup land after consumers have had a chance to migrate.

---

## Scope

The deprecated methods to delete, per class:

- `AbstractInput`: `addChangeListener` / `removeChangeListener` / `addBindingListener`.
- `Binding`: `addChangeListener` / `addCommitListener` / `addRejectListener` / `addBeforeRecordListener`.
- `Tree`: `addSelectionListener`.
- `ButtonGroup`: `addSelectionListener`.
- `Scrollbar`: `addScrollListener` / `removeScrollListener`; `ScrollArrowButton.addTickListener`.
- `SpinButton`: `addTickListener`.
- `WindowBorder`: `addDragListener` / `removeDragListener`.
- `SplitGutter`: `addDragListener` / `removeDragListener` (`destroy` cleanup of the bag stays).
- `ResizeHandle`: `setOnDragStart` / `setOnDragMove` / `setOnDragEnd`, plus the legacy `onDragStart` / `onDragMove` / `onDragEnd` `XOptions` fields.
- `Cell`: `setOnCommit` / `setOnEditEnd`.
- `HeaderCell`: `setOnSortClick` / `setOnContextMenu` / `setOnResizeDrag`.
- `Header` (table): `setOnColumnResize` / `setOnColumnContextMenu`.
- `Accordion`: `setOnSectionToggle`, plus the legacy `onSectionToggle` `XOptions` field.
- `Tab`: `setOnTabClose`, plus the legacy `onTabClose` `XOptions` field.
- `TabPanel.setOnTabClose` forwarder.
- `BooleanEditor`: `setOnChange`.
- `Button`: `addActionListener`.

Plus the call-site migrations. The current footprint:

```bash
# Demo / panel files using deprecated APIs:
grep -rnE '\.add(Action|Selection|Tick|Drag|Scroll|Change|Binding|Commit|Reject|BeforeRecord)Listener\(|\.setOn[A-Z]\w+\(' \
    src/typescript --include="*.ts"
```

Run that snapshot to bound the work before starting.

### Scope expansion (2026-05-30)

The original plan deferred the class-specific `addActionListener` /
`setOn*` surfaces that predate the consistency plan. They are now **in
scope** — this becomes a complete sweep with no residual deprecated
listener surfaces. Additional classes:

- **`addActionListener` family** — each wraps a DOM event through
  `Event.addListener`, so each gains a typed `on(<domevent>, fn)` /
  `off(<domevent>, fn)` shorthand (the `Button` pattern) and loses
  `addActionListener`:
  - `TextField` / `TextArea` / `Slider` → `on("input", fn)`.
  - `Checkbox` → `on("click", fn)`.
  - `RadioButton` / `ToggleButton` / `ComboBox` / `AbstractCustomList`
    / `AbstractListComponent` → `on("change", fn)`.
  - For `ComboBox` / `RadioButton`, the DOM `"change"` reuses the
    `"change"` name: the subclass overrides `on`/`off` to route
    `"change"` to `Event.addListener` while `"binding"` (and the base
    `"change"` ListenerBag path) delegate to `super`. Runtime behaviour
    is preserved exactly.
- **Single-callback `setOn*`** — collapse into `on`/`off`/`emit` exactly
  like their in-scope siblings:
  - `ParentHeaderCell.setOnContextMenu` → `on("contextmenu", fn)`
    `(x, y)`.
  - `Body.setOnVerticalScroll` / `setOnHorizontalScroll` →
    `on("verticalscroll", fn)` `(scrollTop)` / `on("horizontalscroll",
    fn)` `(scrollLeft)`. The legacy `| null`-clears semantics drop (no
    caller passes `null`).
  - `BooleanCell.setOnCommit` → override `on("commit", fn)`, routing to
    the inner checkbox editor's `on("change", fn)`.

Still out of scope (genuinely orthogonal event vocabularies, no
`addXxxListener` / `setOn*` surface): `AutoCompleteField.addChangeListener`
/ `addSelectListener`, `AbstractCustomList.fireChange`, `List.fireChange`,
`MultiSelectList.fireChange` (these are `fire*` internals, not public
registration verbs).

---

## Ordered Implementation Steps

1. Migrate all demo-panel call sites in `src/typescript/*.ts` (and the demo
   subpanels). Mechanical: replace `.addXListener(fn)` with `.on('x', fn)`,
   `.setOnX(fn)` with `.on('x', fn)`. The `Binding.addBefore*` veto
   semantics are preserved — `on("beforerecord", fn)` already routes through
   the same listener bag and the `setRecord` veto loop reads from it.
2. Migrate the lib internal call sites that still go through deprecated
   forwarders: `AutoCompleteDropdown._list.addActionListener` (it's the
   `AbstractCustomList.addActionListener`, which itself is out-of-scope —
   leave) and any others surfaced by the snapshot grep.
3. Delete the `@deprecated` methods listed in **Scope** above.
4. Delete the legacy `onSectionToggle` / `onTabClose` / `onDragStart` /
   `onDragMove` / `onDragEnd` fields from `AccordionOptions`, `TabOptions`,
   and `ResizeHandleOptions`. Update each class's `applyOptions` to drop
   the corresponding dispatch branches.
5. Tear down `setOnSectionToggle`'s null-tolerant forwarder shape — the
   `listeners.sectiontoggle` bag is the canonical form and accepts only
   real listeners.
6. Optional cleanup pass: collapse the private `fireXxx` helpers that now
   only wrap a single `this.emit(...)` call. None of these are public; the
   choice is purely a readability one.
7. Run `npm run typecheck`, `npm run docs:build`, and the manual smoke
   plan from the original consistency plan's **Verification** section.

---

## Verification

- `npx tsc --noEmit` → 0 errors.
- `npm run docs:build` → 0 errors, 0 link warnings.
- Snapshot grep returns 0 hits.
- Manual smoke: every interaction listed in `plans/implemented/listener-shape-consistency.md` § **Verification** still fires its listeners through the canonical API.

---

## Files to Modify

To be enumerated mechanically by the implementer after running the snapshot
grep — every file containing a `.addXListener(` or `.setOnX(` call on one
of the listed classes is in scope. The classes themselves (per the **Scope**
list) lose their deprecated methods.

No files created, no files deleted.

---

## Non-Goals

- **Refactoring the out-of-scope listener APIs** (Slider/Checkbox/TextArea/
  AutoCompleteField/AbstractCustomList/MultiSelectList/ParentHeaderCell).
  Those each pre-date the consistency plan and warrant their own decision.
- **Adding new events.** Migration only.
- **Changing the runtime dispatch semantics.** The forwarders today are
  one-line redirects; deleting them strictly reduces the surface.
