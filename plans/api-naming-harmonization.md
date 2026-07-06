# API Naming Harmonization — Implementation Plan

## Overview

The framework's public surface has accreted several *naming* divergences — the same
concept spelled differently across sibling classes. This plan **owns every public-API
and event-name rename** surfaced by the Section-3 library-gaps audit; every other plan
defers naming decisions here. It changes *names only* — no behaviour moves.

Five clusters are addressed: overlay lifecycle verbs ([`Popover`](src/typescript/lib/overlay/Popover.ts#L456),
[`Drawer`](src/typescript/lib/overlay/Drawer.ts#L332), [`Menu`](src/typescript/lib/overlay/Menu.ts#L227),
the picker dropdown hook), event-name tense/spelling
([`Tab`](src/typescript/lib/layout/Tab.ts#L40), [`Dock`](src/typescript/lib/overlay/Dock.ts#L120),
[`Table`](src/typescript/lib/component/table/Table.ts#L24), [`AbstractStore`](src/typescript/lib/data/AbstractStore.ts#L30)),
value/selection accessors ([`AbstractListComponent`](src/typescript/lib/component/list/AbstractListComponent.ts#L134),
[`AbstractCustomList`](src/typescript/lib/component/list/AbstractCustomList.ts#L1001)),
three colliding `Header` classes plus two vaguely-named list bases, and the
`getPerimiterSize` misspelling ([`Component.ts:2581`](src/typescript/lib/core/Component.ts#L2581)).

**The framework is pre-1.0.** [`docs/reference/migration.md`](docs/reference/migration.md) states
the compatibility policy in force: *"None. Anything in a `0.x.y` release may change without a
migration note."* This is decisive — every rename below is a **hard rename** with **no
`@deprecated` alias**, because (a) the project's own policy grants that latitude, and (b) every
rename here is **compile-safe**: framework-custom event names are string-literal `XEvent` unions
(a stale `on("oldname", …)` is a *compile error*, not a silent runtime miss), and every renamed
method/type is caught by `npm run typecheck`. The typecheck and per-name `grep … — expect zero`
checkpoints are the safety net; there is nothing to alias.

**Sequencing:** this plan carries the highest churn and the highest merge-conflict surface of
the Section-3 set, so it must be **implemented LAST** — after the structural/consolidation plans
have settled the code, so stable code is renamed exactly once. No `depends-on` frontmatter is set
(the dependency is a sequencing preference, not a hard file-level dep), but treat "implement last"
as binding.

---

## Drift Reconciliation (2026-07-06 — after phases 1–2 merged)

This plan was deferred to run last, against settled code. Two of its renames are now
**obsolete no-ops** because the merged consolidation plans already *removed* their targets —
a cleaner outcome than renaming. **Skip steps 2 and 3.**

- **`showDropdown` → `placeDropdown` (step 2): OBSOLETE.** The `input-field-fixes-and-scaffolding-consolidation`
  plan deleted the abstract `showDropdown` hook entirely (its `openDropdown` now calls
  `dropdown.showAt(...)` directly). `grep -rn showDropdown src/ tests/` → **zero**. Nothing to rename.
- **`getSelectedValue` → `getValue` (step 3): OBSOLETE.** The `data-view-virtualization-consolidation`
  plan (bug 5) removed the dead `<select>`-backed selection surface from `AbstractListComponent`,
  including `getSelectedValue`. `grep -rn getSelectedValue src/ tests/` → **zero**. Nothing to rename.
  (`AbstractListComponent` is still renamed to `AbstractMarkerList` under step 7 — only the
  `getValue` fold-in disappears.)

All other renames remain valid and their targets are present on the settled base: `getPerimiterSize`
(41 refs), `selectionchange` (Table/Body), the event-tense outliers (`activated`/`detached`/`docked`/
`moved`/`reordered`), the store `*changed` events (`datachanged`/`sortchanged`/`pagechanged`/
`loadingchanged`, single-quoted), `table/Header`→`TableHeader`, and both list-base families
(`AbstractCustomList*`, `AbstractListComponent*`). Line-number anchors throughout have shifted from
the consolidation edits — target every rename by symbol/content, not by the line numbers cited below.

---

## Architecture Decisions

### Overlay lifecycle: codify the two-archetype convention; fix only the real collision

The show/hide vs open/close split is **largely legitimate and stays** — forcing `Tooltip`,
`Notification`, `Dialog`, and `AbstractWindow` into `open`/`close` would be worse, not better.
The framework has two overlay archetypes, and the canonical rule is:

- **Transient / imperatively-revealed overlays** use **`show()` / `hide()`**: `Tooltip`,
  `Notification`, `Popover`, `DragGhost`, `DropZoneOverlay`, `AbstractWindow`, `Dialog`, and
  `Menu`'s context-popup mode.
- **Bi-stable / toggleable overlays** use **`open()` / `close()`** paired with **`isOpen()`**:
  `Drawer`, `AnimatedDropdown` (and every dropdown/picker that extends it), and `Menu`'s
  persistent mode.
- **`isOpen()` is the universal state query** — any overlay that persists between its reveal
  and its dismissal MAY expose it regardless of which mutator pair it uses (this is why
  `Popover.isOpen()` coexists with `show`/`hide` without contradiction).

Under this rule, **only one genuine defect remains**: the picker family exposes a `showDropdown`
*and* an `openDropdown`, which reads as two names for one action. They are in fact different
roles — [`AbstractPickerField.openDropdown`](src/typescript/lib/component/input/AbstractPickerField.ts#L477)
is the orchestrator; [`showDropdown`](src/typescript/lib/component/input/AbstractPickerField.ts#L162)
is the `protected abstract` template hook a subclass implements to *position and reveal its
concrete dropdown*. The fix is to rename the hook so "show" disappears from the picker
vocabulary: **`showDropdown` → `placeDropdown`** (it computes the anchor rect and calls the
dropdown's `showAt`). This is `protected`, has one abstract declaration + three overrides
(`DateField`, `TimeField`, `DateTimeField`), zero application callers, and zero doc references.

**`Dialog.hide(result)` stays as-is** ([`Dialog.ts:938`](src/typescript/lib/overlay/Dialog.ts#L938)).
The `result` argument is intrinsic, not accidental: `Dialog.show()` returns
`Promise<DialogResult>` and `hide(result)` *resolves* it — a request/response modal, not a
toggle. The arg asymmetry vs the nullary `hide()` on other overlays is correct and is documented
as intentional. `Dialog` has no shared base forcing a uniform `hide` signature, so the two
coexist.

**`Menu`'s four-verb surface stays** (`show`/`hide` for popup, `open`/`close` for persistent).
Each pair maps to a real, mutually-exclusive mode; collapsing them would conflate the modes.
Documented as a dual-mode surface.

The mass `show`/`hide` ↔ `open`/`close` migration is a **Non-Goal** (see below): all-churn,
no-clarity once the convention is written down.

### Events: present-tense / noun form, lowercase, unseparated

The framework's dominant and documented event vocabulary is **present-tense/noun**: `action`,
`change`, `selection`, `load`, `scroll`, `commit`, `sectiontoggle`, `filterchange`, `groupchange`.
The past-tense outliers are a small, concentrated set — `activated`, `detached`, `docked`,
`moved`, `reordered`, and the store's `sortchanged` / `pagechanged` / `loadingchanged` /
`datachanged` compounds. **Present tense is the canonical convention; the outliers are migrated
to it.** (`selectionchange` is *already* present tense — the selection divergence is noun-vs-compound,
resolved to the noun `selection`, not a tense issue.)

Because every emitting class declares a string-literal `XEvent` union, each rename is compile-safe:
after renaming the union member, every stale `on`/`off`/`emit` string is a type error until fixed.

### Value accessors: `getValue`/`setValue` for the bound value, `getSelectedRecord(s)` for the model

Two accessor families are legitimate and distinct:

- **`getValue()` / `setValue()`** — the `Bindable` contract's *primitive* value (string,
  `string[]`, boolean). Canonical everywhere a component carries a bound value.
- **`getSelectedRecord()` (single) / `getSelectedRecords()` (multi)** — the backing `ModelRecord`(s),
  richer than the primitive value. Canonical for record access; singular on single-select
  (`ComboBox`, `AbstractCustomList`), plural on multi-select (`MultiSelectList`).

The third name, **`getSelectedValue()`** on
[`AbstractListComponent`](src/typescript/lib/component/list/AbstractListComponent.ts#L134),
returns the selected item's value and overlaps `getValue()` in role. It is renamed
**`getSelectedValue` → `getValue`** to fold into the `Bindable` contract (its `getSelectedIndex`
sibling keeps its descriptive name — index access is a distinct axis).

**Boolean inputs:** `getValue()`/`setValue()` is the universal boolean accessor across
`Checkbox`, `RadioButton`, and `Toggle`. `isSelected()`/`setSelected()` stay as
`Checkbox`/`RadioButton` *domain sugar* (a checkbox is idiomatically "checked/selected") and are
**deliberately not added to `Toggle`** — a toggle is on/off, not "selected." This is already the
code's state; the decision is to *document the rule* (call `getValue`/`setValue` for portability),
not to rename. Zero code churn.

**Silent-update flag:** the `fireEvent` parameter (default `true`) on the three `setSelectedIndex`
overloads is the canonical name for a suppress-the-event flag; it is already internally consistent
(no `silent` spelling exists). No rename; the decision is to standardize *future* silent flags on
`fireEvent`.

### Class disambiguation: `TableHeader`, `AbstractMarkerList`, `AbstractSelectableList`

**Three `Header` classes.** Only two literally collide as an exported base name:
[`display/Header`](src/typescript/lib/component/display/Header.ts#L46) (a panel/title-bar
`Container`) and [`table/Header`](src/typescript/lib/component/table/Header.ts#L47) (the table's
column-header strip). The third, [`table/cell/Header.ts`](src/typescript/lib/component/table/cell/Header.ts#L82),
already exports its class as `HeaderCell` — no collision. Decision: keep the generic
`display/Header` as **`Header`** and rename the table strip **`table/Header` → `TableHeader`**
(matching the alias [`docs/components/Header.md`](docs/components/Header.md) already recommends).
Its event union `HeaderEvent` → `TableHeaderEvent`; its options `HeaderOptions` (table) → `TableHeaderOptions`
if present. Optionally rename the file `table/cell/Header.ts` → `HeaderCell.ts` so the filename
matches its `HeaderCell` class (internal import-path only), but this is low-value and flagged
optional.

**Two list bases.** [`AbstractListComponent`](src/typescript/lib/component/list/AbstractListComponent.ts#L28)
backs the bulleted/numbered display lists (`BulletedList`, `NumberedList`);
[`AbstractCustomList`](src/typescript/lib/component/list/AbstractCustomList.ts#L587) backs the
selectable data-bound lists (`List`, `MultiSelectList`, `ComboBox`). "ListComponent" and
"CustomList" carry no signal about which is which. Decision, anchored on each base's concrete
subclasses:

- `AbstractListComponent` → **`AbstractMarkerList`** (its subclasses render bullet/number *markers*),
  `AbstractListOptions` → `AbstractMarkerListOptions`.
- `AbstractCustomList` → **`AbstractSelectableList`** (its subclasses are *selectable*),
  `AbstractCustomListOptions` → `AbstractSelectableListOptions`,
  `CustomListRow` → `SelectableListRow`,
  `CustomListItem` → `SelectableListItem`, `CustomListItemSpec` → `SelectableListItemSpec`.

`AbstractMarkerList` is re-exported from the list barrel (public → docs impact);
`AbstractSelectableList` is *not* re-exported from the barrel (exported only from its own module),
so it is outside the typedoc public surface — its rename is internal-only.

### `getPerimiterSize` → `getPerimeterSize`

The public method [`Component.getPerimiterSize`](src/typescript/lib/core/Component.ts#L2581) is
misspelled; its own return interface `PerimeterSize` is spelled correctly. Hard-rename the method,
its one override [`FieldSet.getPerimiterSize`](src/typescript/lib/component/container/FieldSet.ts#L178),
and all ~40 call sites across `BoxLayout`/`VBox`/`HBox`/`Grid`/`Fit`/`Border`/`Card`/`Split`/
`Accordion`/`Tab`/`HFlow`/`VFlow` and the components `Button`/`Text`/`ComboBox`/`AbstractCustomList`/
`AbstractCalendarDropdown`/`AutoCompleteDropdown`. The local variables named `perimiterSize` /
`perim` are renamed to the correct spelling in the same edits (pure typo fix, private, zero
external impact) so the corrected spelling is consistent. The self-referential JSDoc
`{@link getPerimiterSize}` links and the doc-anchor URL in `Component.ts` are updated to the new
name.

---

## Public API

Renamed **methods** (signatures unchanged except the name):

```typescript
// core/Component.ts (+ override in container/FieldSet.ts)
getPerimeterSize(): PerimeterSize            // was getPerimiterSize

// component/list/AbstractListComponent.ts  (→ AbstractMarkerList)
getValue(): string | undefined              // was getSelectedValue

// component/input/AbstractPickerField.ts (protected abstract) + DateField/TimeField/DateTimeField overrides
protected abstract placeDropdown(dropdown: TDropdown, anchorEl: Handle, value: TValue | null): void;  // was showDropdown
```

Renamed **event union members** (each is compile-checked at every `on`/`off`/`emit` site):

```typescript
// layout/Tab.ts
type TabEvent = "tabclose" | "empty" | "detach" | "activate" | "dock";
//   was:                              "detached" "activated"  "docked"

// overlay/Dock.ts
type DockEvent = "attach" | "detach" | "move" | "focus" | "close" | "emptychange";
//   was:                              "moved"

// component/container/TabBar.ts
type TabBarEvent = "tabpressed" | "reorder" | "tabclose" | "dockrequested"
//   was:                         "reordered"
                 | "tabdragstart" | "tearoffrequested" | "detach" | "dockhover";
//   was:                                                 "detached"

// component/table/Table.ts  &  component/table/Body.ts
type TableEvent = "selection" | "cellclick";                       // was "selectionchange"
type BodyEvent  = "verticalscroll" | "horizontalscroll" | "selection" | "cellclick";  // was "selectionchange"

// data/AbstractStore.ts
type StoreEvent = 'load' | 'beforeload' | 'datachange' | ... | 'loadingchange'
//   was:                                  'datachanged'        'loadingchanged'
                | 'pagechange' | 'pagechangeblocked' | 'sortchange' | 'filterchange' | ...;
//   was:          'pagechanged'                        'sortchanged'
```

Renamed **classes / types** (with their barrel re-exports):

```
table/Header.ts          class Header          → class TableHeader
                         type  HeaderEvent     → type  TableHeaderEvent
                         type  HeaderOptions    → type  TableHeaderOptions   (if declared)

list/AbstractListComponent.ts   AbstractListComponent  → AbstractMarkerList
                                AbstractListOptions    → AbstractMarkerListOptions

list/AbstractCustomList.ts      AbstractCustomList      → AbstractSelectableList
                                AbstractCustomListOptions → AbstractSelectableListOptions
                                CustomListRow           → SelectableListRow
                                CustomListItem          → SelectableListItem
                                CustomListItemSpec      → SelectableListItemSpec
```

`display/Header` (class `Header`), `Checkbox`/`RadioButton` `isSelected`/`setSelected`, `Toggle`
`getValue`/`setValue`, `getSelectedRecord(s)`, the `fireEvent` parameter, `Dialog.hide(result)`,
and `Menu`'s four verbs are **unchanged** (see Non-Goals / Architecture Decisions).

---

## Ordered Implementation Steps

Each rename is a self-contained unit. After **every** rename, run its grep checkpoint (over both
`src/` and `tests/`) and `npm run typecheck` — a clean typecheck is the proof the rename is
complete. Group commits per the commit skill's one-functionality rule (one cluster per code commit).

1. **`getPerimiterSize` → `getPerimeterSize`.** Rename the method
   ([`Component.ts:2581`](src/typescript/lib/core/Component.ts#L2581)) and its override
   ([`FieldSet.ts:178`](src/typescript/lib/component/container/FieldSet.ts#L178)); update all
   call sites in `layout/{BoxLayout,VBox,HBox,Grid,Fit,Border,Card,Split,Accordion,Tab,HFlow,VFlow}.ts`
   and `component/{button/Button,input/Text,input/ComboBox,input/AbstractCalendarDropdown,input/AutoCompleteDropdown,list/AbstractCustomList,container/FieldSet}.ts`;
   rename the local `perimiterSize`/`perim` vars in the same files; update the `{@link}` and
   doc-anchor references in `Component.ts` (lines ~45, ~1584). Demo files
   `src/typescript/BaselinePanel.ts` uses the method indirectly — grep confirms.
   → verify: `grep -rn 'getPerimiterSize\|perimiterSize' src/ tests/ — expect zero`; `codegraph_impact getPerimiterSize` re-run returns nothing; `npm run typecheck` clean.

2. **`showDropdown` → `placeDropdown`. — OBSOLETE, SKIP** (see Drift Reconciliation). The abstract
   `showDropdown` hook was removed by `input-field-fixes-and-scaffolding-consolidation`; `grep -rn
   'showDropdown' src/ tests/` already returns zero. No edit.

3. **`getSelectedValue` → `getValue`. — OBSOLETE, SKIP** (see Drift Reconciliation). `getSelectedValue`
   was removed with the dead selection surface by `data-view-virtualization-consolidation` (bug 5);
   `grep -rn 'getSelectedValue' src/ tests/` already returns zero. No edit. (The `AbstractListComponent`
   → `AbstractMarkerList` class rename still happens under step 7.)

4. **Event tense/spelling renames.** For each union, change the member(s) then chase every
   `on`/`off`/`emit`/JSDoc string; the string-literal type makes misses compile errors:
   - `Tab.ts` / `TabBar.ts` / `Dock.ts`: `activated→activate`, `detached→detach`, `docked→dock`,
     `moved→move`, `reordered→reorder`. **Cross-wiring:** `Dock` subscribes to `Tab`'s
     `"activated"`/`"detached"` and its own `"moved"` — update `Dock.ts` listener registrations
     ([~1002–1240](src/typescript/lib/overlay/Dock.ts#L1002)) in lockstep.
   - `Table.ts` / `Body.ts`: `selectionchange→selection` (including `Table`'s re-emit of
     `Body`'s event at [`Table.ts:181`](src/typescript/lib/component/table/Table.ts#L181)).
   - `AbstractStore.ts`: `datachanged→datachange`, `sortchanged→sortchange`,
     `pagechanged→pagechange`, `loadingchanged→loadingchange`; chase every `fireEvent`/`on`/`emit`
     across `data/` and consumers (`Table`, `PaginationBar`, `Tree`, demo panels).
   - Demo app: `src/typescript/MiscPanel.ts` listens to `"selection"` (Tree/ButtonGroup — already
     canonical, no change) and dock `"close"` (unchanged); confirm no stale `"selectionchange"`/
     `"activated"`/`"moved"` strings remain in `src/typescript/*.ts`.
   → verify per name: `grep -rn '"selectionchange"\|"activated"\|"detached"\|"docked"\|"moved"\|"reordered"\|"datachanged"\|"sortchanged"\|"pagechanged"\|"loadingchanged"' src/ tests/ — expect zero`; typecheck clean.

5. **`table/Header` → `TableHeader`.** Rename the class
   ([`table/Header.ts:47`](src/typescript/lib/component/table/Header.ts#L47)), `HeaderEvent→TableHeaderEvent`,
   `HeaderOptions→TableHeaderOptions` (if declared); update importers `Table.ts` (import, field
   `_header`, `addComponent` param), `Body.ts` (import type, `_header`, `setHeader`), and the
   barrel [`table/index.ts:14–15`](src/typescript/lib/component/table/index.ts#L14). Leave
   `display/Header` untouched. (Optional: rename file `table/cell/Header.ts` → `HeaderCell.ts` and
   fix the one barrel import path — flag separately, skippable.)
   → verify: `grep -rn "component/table/Header" src/ tests/` resolves only to the renamed symbol;
   no exported base name `Header` remains in the table group; typecheck clean.

6. **`AbstractCustomList` → `AbstractSelectableList` + companions.** Rename the class and
   `CustomListRow` ([:1710 export](src/typescript/lib/component/list/AbstractCustomList.ts#L1710)),
   `AbstractCustomListOptions` ([:83](src/typescript/lib/component/list/AbstractCustomList.ts#L83)),
   and `CustomListItem`/`CustomListItemSpec`; update subclasses `List.ts`, `MultiSelectList.ts`,
   `ComboBox.ts`, the list barrel's `CustomListItem`/`CustomListItemSpec` re-exports
   ([`list/index.ts:7`](src/typescript/lib/component/list/index.ts#L7)), and all internal refs (~9 files).
   → verify: `grep -rn 'AbstractCustomList\|CustomListRow\|CustomListItem' src/ tests/ — expect zero`;
   typecheck clean.

7. **`AbstractListComponent` → `AbstractMarkerList` + options.** Rename the class
   ([:28](src/typescript/lib/component/list/AbstractListComponent.ts#L28)) and `AbstractListOptions`;
   update subclasses `BulletedList.ts`, `NumberedList.ts`, and the barrel re-exports
   ([`list/index.ts:8–9`](src/typescript/lib/component/list/index.ts#L8)). Consider renaming the
   file to `AbstractMarkerList.ts` for grep-ability (import-path only).
   → verify: `grep -rn 'AbstractListComponent\|AbstractListOptions' src/ tests/ — expect zero`;
   typecheck clean.

8. **Docs + convention docs** (see Documentation Impact). Update handwritten doc pages, regenerate
   the typedoc API, update `ARCHITECTURE.md`'s event-name examples (`datachanged`), and add a
   changelog entry.
   → verify: `npm run docs:build` finishes with **zero** warnings; `grep -rln` for each old name
   across `docs/` returns only `docs/reference/changelog.md` (historical, intentionally kept).

9. **Full-suite gate.** `npm run typecheck`, `npm run typecheck:test`, `npm run test`,
   `npm run lint`, `npm run build:lib`, `npm run docs:build` — all clean.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` (method rename, locals, JSDoc links) |
| Modify | `src/typescript/lib/component/container/FieldSet.ts` (override + locals) |
| Modify | `src/typescript/lib/layout/{BoxLayout,VBox,HBox,Grid,Fit,Border,Card,Split,Accordion,Tab,HFlow,VFlow}.ts` (perimeter call sites) |
| Modify | `src/typescript/lib/component/button/Button.ts`, `component/input/{Text,ComboBox,AbstractCalendarDropdown,AutoCompleteDropdown}.ts` (perimeter) |
| Modify | `src/typescript/lib/component/input/{AbstractPickerField,DateField,TimeField,DateTimeField}.ts` (`placeDropdown`) |
| Modify | `src/typescript/lib/component/list/AbstractListComponent.ts` → **rename to `AbstractMarkerList.ts`** (class, options, `getValue`) |
| Modify | `src/typescript/lib/component/list/AbstractCustomList.ts` (class, options, `SelectableListRow`, item types) |
| Modify | `src/typescript/lib/component/list/{List,MultiSelectList,BulletedList,NumberedList}.ts`, `component/input/ComboBox.ts`, `component/list/index.ts` (list-base refs + barrel) |
| Modify | `src/typescript/lib/layout/Tab.ts`, `component/container/TabBar.ts`, `overlay/Dock.ts` (event tense + cross-wiring) |
| Modify | `src/typescript/lib/component/table/Table.ts`, `component/table/Body.ts`, `component/table/index.ts` (`selection` event; `TableHeader`) |
| Modify | `src/typescript/lib/component/table/Header.ts` (`Header`→`TableHeader`, event/options) |
| Modify | `src/typescript/lib/data/AbstractStore.ts` (+ any `TreeStore.ts` overlap) (`*change` events) |
| Modify | `src/typescript/*.ts` demo panels (`MiscPanel.ts`, `BaselinePanel.ts`, …) — stale event/method strings |
| Modify | `tests/**` — every reference to a renamed symbol/event (see grep counts in Verification) |
| Modify | `docs/components/{Header,Table,Body,List,MultiSelectList,ComboBox,BulletedList,NumberedList,Dock,TabBar,TreeTable,MenuBar}.md`, `docs/data/store.md` (handwritten refs) |
| Modify | `ARCHITECTURE.md` (event-name example `datachanged`), `docs/reference/changelog.md` (new entry) |
| Optional | Rename `src/typescript/lib/component/table/cell/Header.ts` → `HeaderCell.ts` + barrel import |

---

## Expected Behaviour

This is a **pure rename** — no behaviour changes. The contract is the *invariants*, verified
mechanically rather than by new unit tests:

- **Zero old names remain.** For every rename, `grep -rn '<oldName>' src/ tests/` returns nothing
  (except `docs/reference/changelog.md`, which is historical record and intentionally untouched).
- **Typecheck is green** after each rename and at the end — the string-literal `XEvent` unions and
  typed methods make every stale reference a compile error, so a clean `npm run typecheck` /
  `typecheck:test` proves completeness. (Unit-testable via the existing suite; no new tests are
  written for a rename.)
- **Runtime event fan-out is identical.** A listener registered under the *new* event name fires
  exactly when the old one did — same emit sites, same payloads, same order. The existing
  `tests/` selection/store/tab suites (which reference the renamed events) are the regression
  guard once updated to the new names; they must stay green. *(Cross-component wiring — `Dock` ↔
  `Tab`/`Window`, `Table` ↔ `Body` — is the one place a missed rename could silently no-op an
  event subscription; the typecheck catches the union mismatch, but manually exercise Dock
  attach/detach/activate and Table row-selection in the demo app as belt-and-suspenders — these
  are event/geometry flows the offline harness can't fully drive.)*
- **`getPerimeterSize` returns byte-identical geometry** — layout output (row/column extents,
  preferred sizes) is unchanged; the existing layout tests are the guard.

---

## Verification

- `grep -rn` zero-match checkpoints per step (listed inline above), run over **both `src/` and
  `tests/`**. Known stale-reference counts to clear in `tests/`: `getSelectedRecord` 5 (kept —
  *not* renamed), `selectionchange` 7, `AbstractCustomList` 5, `AbstractListComponent` 1,
  `getPerimiterSize` 1 (these last four must reach zero).
- `npm run typecheck` and `npm run typecheck:test` — clean after every rename.
- `npm run test` (vitest) — the selection/store/tab/layout suites stay green after their string
  updates.
- `npm run lint` and `npm run test:lint` — no new violations (no raw-DOM/style rules touched).
- `npm run build:lib` — the published `dist/lib` rebuilds; **note the cross-repo consumer**
  (`sqladmin`) imports these public names and will not see the change until this rebuild, and will
  need its own rename pass at its typecheck (see Potential Challenges).
- `npm run docs:build` (`docs:api` typedoc → vitepress) — **zero warnings**, per
  [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) ("Don't `{@link}` internal symbols").
- Manual smoke in the demo app (`npm run dev`, http://localhost:8015): Dock panel
  attach/detach/activate, Tab activation/close/dock, Table row-selection, a picker dropdown
  open/close — confirm events still drive their handlers.

---

## Documentation Impact

Per the project's docs conventions (typedoc entry points are the per-group barrels
`src/typescript/lib/<group>/index.ts`; handwritten guides live under `docs/`):

- **Regenerated API (`docs/api`, typedoc).** Automatic on `docs:api`. The public symbols whose
  generated pages/anchors change: `Component#getperimitersize` → `#getperimetersize`
  (anchor changes — fix the self-link in `Component.ts` JSDoc), `AbstractListComponent` →
  `AbstractMarkerList` (list barrel), `table` group `Header` → `TableHeader`, `AbstractListOptions`
  → `AbstractMarkerListOptions`, and the `selection`/`*change` event names in the `Table`/`Body`/
  `Store` docs. `AbstractSelectableList` and its companions are **not** barrel-exported, so they
  do not appear in the API docs — no page churn there.
- **Handwritten pages to edit** (grep-confirmed references to old names):
  `docs/components/Header.md` (the whole "different class with the same name" workaround section
  now describes `Header` vs `TableHeader`), `docs/components/Table.md` and `docs/components/Body.md`
  (`selectionchange`→`selection`), `docs/components/List.md` / `MultiSelectList.md` / `ComboBox.md`
  / `BulletedList.md` / `NumberedList.md` (list-base names, `getValue`), `docs/components/Dock.md`
  / `TabBar.md` / `TreeTable.md` (`moved`/`detached`/`activated`/`reordered`→ present tense),
  `docs/components/MenuBar.md` (event refs), `docs/data/store.md` (`datachanged`/`sortchanged`/
  `pagechanged`/`loadingchanged`→ present tense).
- **`{@link}` audit.** After renames, re-scan public JSDoc for links to now-internal names
  (`AbstractSelectableList` etc.) and rewrite as prose per the CODE_CONVENTIONS rule; confirm
  `docs:build` is warning-free.
- **Convention docs to update (source-of-truth for the *decisions*):** `ARCHITECTURE.md`'s
  event-handling section names `datachanged` and `tabclose` as canonical examples — change
  `datachanged` → `datachange` there (`tabclose` is unchanged). Optionally add the overlay
  lifecycle convention (show/hide vs open/close/isOpen) and the value-accessor convention to
  `ARCHITECTURE.md` or the relevant `docs/concepts/*` page so the *decisions* are documented, not
  just the code.
- **Changelog.** Add one `docs/reference/changelog.md` entry summarizing the harmonization
  (renamed events/methods/classes). **Do not rewrite** existing historical changelog lines that
  mention `getPerimiterSize`/`AbstractCustomList` — they record what shipped.
- **Migration guide.** `docs/reference/migration.md` states pre-1.0 needs no migration notes;
  honour that — no new migration section is required, though the changelog entry doubles as the
  informal note.

---

## Potential Challenges

- **Cross-repo consumer breakage.** The `sqladmin` repo consumes the built `dist/lib` and imports
  these public names/events; a store `*change` rename or a `TableHeader` rename breaks *its*
  typecheck. Mitigation: land + `build:lib` here, then run the same rename pass in `sqladmin`
  (out of scope for this plan, but flag it in the changelog/handoff).
- **Cross-component event wiring silently no-ops.** `Dock` subscribes to `Tab`/`Window` events by
  string; a partial rename would compile only if *both* sides are renamed together. Mitigation:
  rename each union and all its subscribers in one commit; typecheck between clusters.
- **Merge conflicts with the structural plans.** These renames touch the same files the
  consolidation plans edit. Mitigation: implement this plan **last**, after those merge, so each
  file is renamed exactly once against settled code.
- **File renames vs git history.** Renaming `AbstractListComponent.ts`/`AbstractCustomList.ts`
  files changes import paths repo-wide. Mitigation: rename the file and fix imports in the same
  commit; `git mv` to preserve blame.

---

## Critical Files

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — event-surface split (`Event.X` vs `on`/`off`/`emit`), the
  canonical event list this plan amends, the callable-export rule renamed classes must preserve.
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — the "no `{@link}` to internal symbols" docs rule
  gating `docs:build`.
- [`docs/reference/migration.md`](docs/reference/migration.md) — the pre-1.0 "no aliases required"
  policy that justifies hard renames.
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — `getPerimiterSize`
  + `PerimeterSize` interface.
- [`src/typescript/lib/component/list/index.ts`](src/typescript/lib/component/list/index.ts) and
  [`component/table/index.ts`](src/typescript/lib/component/table/index.ts) — the barrels whose
  re-exports define the public (typedoc) surface.
- [`src/typescript/lib/overlay/Dock.ts`](src/typescript/lib/overlay/Dock.ts) — the cross-component
  event subscriber most exposed to a partial event rename.

---

## Non-Goals

- **Mass `show`/`hide` ↔ `open`/`close` migration.** The two-archetype convention is codified
  instead (Architecture Decisions). Forcing `Tooltip`/`Notification`/`Dialog`/`AbstractWindow`
  into `open`/`close` is all churn, no clarity.
- **`Dialog.show()`/`Dialog.hide(result)` signature change.** Intentional request/response modal;
  the `result` arg is intrinsic, documented, kept.
- **`Menu`'s four-verb surface.** Two real modes (popup `show`/`hide`, persistent `open`/`close`);
  kept and documented.
- **Adding `isOpen()` to overlays that lack it.** Speculative API surface (Simplicity First);
  `isOpen()` is declared the universal *convention* but added only where a consumer needs it.
- **`isSelected`/`setSelected` on `Toggle`.** A toggle is on/off, not "selected"; `getValue`/
  `setValue` is the portable accessor and already present. No rename.
- **Renaming `getSelectedRecord`/`getSelectedRecords`.** These are the canonical *record*
  accessors and stay; only the overlapping `getSelectedValue`→`getValue` moves.
- **Drag/resize event-granularity unification** (`drag` vs `dragmove`; `columnresizestart`/
  `columnresize` vs `resizestart`/`resizedrag`). All are already present-tense; the inconsistency
  is naming *granularity* across purely internal component-to-component events (`SplitGutter`→
  `Split`, `WindowBorder`→`AbstractWindow`, `HeaderCell`→`Header`→`Body`) with no consumer or docs
  surface. High wiring churn, low payoff. The canonical families `dragstart`/`dragmove`/`dragend`
  and `resizestart`/`resizemove`/`resizeend` are documented as the go-forward convention without
  rewiring existing code. `tabclose`/`close` are likewise kept (present-tense, the prefix
  disambiguates a tab-close from a window/dock close).
- **`silent`/`fireEvent` flag rename.** `fireEvent` is already internally consistent; no `silent`
  spelling exists to reconcile.
- **`@deprecated` back-compat aliases.** The pre-1.0 policy explicitly waives migration notes;
  aliases would be pure churn.
